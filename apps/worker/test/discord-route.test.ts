import { afterEach, expect, it, vi } from "vitest";
import worker from "../src/index";
import { createDiscordAuthStore } from "../src/discord-auth-store";
import { issueTrialCookie } from "../src/trial-access";
import { createRoomApi } from "../src/room-api";

afterEach(() => vi.unstubAllGlobals());
it("authenticates through Discord and forwards only server-verified identity to the room", async () => {
  let data: unknown;
  const store = createDiscordAuthStore({ async get() { return data; }, async put(value) { data = structuredClone(value); } });
  const gate = { async fetch(request: Request) {
    const input = await request.json() as { action: string; next?: string; key?: string; identity?: any };
    const now = Date.now();
    const value = input.action === "discord.begin" ? await store.begin(input.next!, now)
      : input.action === "discord.state" ? await store.consumeState(input.key!, now)
      : input.action === "discord.issue" ? await store.issueGrant(input.identity, now)
      : input.action === "discord.read" ? await store.getGrant(input.key!, now)
      : input.action === "discord.consume" ? await store.consumeGrant(input.key!, now) : null;
    return Response.json({ value });
  } };
  let forwarded: string | null = null;
  const room = { async fetch(request: Request) { forwarded = request.headers.get("x-wf-discord-identity"); return Response.json({ snapshot: { room: { roomCode: "ABC234" } } }); } };
  const env = { TRIAL_MODE: "off", DISCORD_CLIENT_ID: "123456", DISCORD_CLIENT_SECRET: "test-secret", DISCORD_REDIRECT_URI: "https://example.test/api/discord/callback",
    TRIAL_GATE: { idFromName: () => "gate", get: () => gate }, ROOMS: { idFromName: () => "room", get: () => room } } as any;
  vi.stubGlobal("fetch", async (url: string) => url.endsWith("/oauth2/token") ? Response.json({ access_token: "temporary", token_type: "Bearer" }) : Response.json({ id: "123456789012345678", username: "user", global_name: "名前", avatar: null }));
  const start = await worker.fetch(new Request("https://example.test/api/discord/start?next=%2F%3Froom%3DABC234"), env);
  expect(start.status).toBe(303);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const stateCookie = start.headers.get("set-cookie")!.split(";")[0]!;
  const callback = await worker.fetch(new Request(`https://example.test/api/discord/callback?state=${state}&code=abc`, { headers: { cookie: stateCookie } }), env);
  expect(callback.status).toBe(303);
  const grantCookie = callback.headers.getSetCookie().find(value => value.startsWith("wf_discord="))!.split(";")[0]!;
  const profile = await worker.fetch(new Request("https://example.test/api/discord/profile", { headers: { cookie: grantCookie } }), env);
  expect(await profile.json()).toEqual({ configured: true, profile: { displayName: "名前", avatarUrl: expect.stringMatching(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/) } });
  const joined = await worker.fetch(new Request("https://example.test/api/rooms/ABC234/join", { method: "POST", headers: { cookie: grantCookie, "x-wf-discord-identity": "forged", "x-wf-use-discord": "1" }, body: JSON.stringify({ name: "名前" }) }), env);
  expect(joined.status).toBe(200);
  expect(JSON.parse(decodeURIComponent(forwarded!))).toEqual({ id: "123456789012345678", displayName: "名前", avatar: null });
  expect((await worker.fetch(new Request("https://example.test/api/rooms/ABC234/join", { method: "POST", headers: { "x-wf-discord-identity": "forged" }, body: JSON.stringify({ name: "anonymous" }) }), env)).status).toBe(200);
  expect(forwarded).toBeNull();
  const expired = await worker.fetch(new Request("https://example.test/api/rooms/ABC234/join", { method: "POST", headers: { "x-wf-use-discord": "1" }, body: JSON.stringify({ name: "名前" }) }), env);
  expect(expired.status).toBe(401);
  expect(await expired.json()).toEqual({ error: "discord_expired" });
});

it("requires the trial code at start but permits the cross-site Discord callback without a Strict trial cookie", async () => {
  let data: unknown;
  const store = createDiscordAuthStore({ async get() { return data; }, async put(value) { data = structuredClone(value); } });
  const gate = { async fetch(request: Request) {
    const input = await request.json() as { action: string; next?: string; key?: string; identity?: any };
    const now = Date.now();
    if (input.action === "discord.begin") return Response.json({ value: await store.begin(input.next!, now) });
    if (input.action === "discord.state") return Response.json({ value: await store.consumeState(input.key!, now) });
    if (input.action === "discord.issue") return Response.json({ value: await store.issueGrant(input.identity, now) });
    return Response.json({ allowed: true });
  } };
  const env = { TRIAL_MODE: "on", TRIAL_CODE: "trial-test", DISCORD_CLIENT_ID: "123456", DISCORD_CLIENT_SECRET: "secret", DISCORD_REDIRECT_URI: "https://example.test/api/discord/callback",
    TRIAL_GATE: { idFromName: () => "gate", get: () => gate }, REQUEST_LIMITER: { async limit() { return { success: true }; } }, LOGIN_LIMITER: { async limit() { return { success: true }; } } } as any;
  vi.stubGlobal("fetch", async (url: string) => url.endsWith("/oauth2/token") ? Response.json({ access_token: "temporary", token_type: "Bearer" }) : Response.json({ id: "123456789012345678", username: "user", avatar: null }));
  const request = "https://example.test/api/discord/start?next=%2F%3Froom%3DABC234";
  const unauthenticated = await worker.fetch(new Request(request), env);
  expect(unauthenticated.status).toBe(303);
  expect(unauthenticated.headers.get("location")).toContain("/trial?next=");
  const trialCookie = await issueTrialCookie(env.TRIAL_CODE, Date.now());
  const start = await worker.fetch(new Request(request, { headers: { cookie: `wf_trial=${trialCookie}` } }), env);
  expect(start.status).toBe(303);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const stateCookie = start.headers.get("set-cookie")!.split(";")[0]!;
  const callback = await worker.fetch(new Request(`https://example.test/api/discord/callback?state=${state}&code=abc`, { headers: { cookie: stateCookie } }), env);
  expect(callback.status).toBe(303);
  expect(callback.headers.get("location")).toBe("/?room=ABC234");
});

it("restores a Discord host on a second device using real room-session logic", async () => {
  let authData: unknown;
  const authStore = createDiscordAuthStore({ async get() { return authData; }, async put(value) { authData = structuredClone(value); } });
  const gate = { async fetch(request: Request) {
    const input = await request.json() as { action: string; next?: string; key?: string; identity?: any };
    const now = Date.now();
    const value = input.action === "discord.begin" ? await authStore.begin(input.next!, now)
      : input.action === "discord.state" ? await authStore.consumeState(input.key!, now)
      : input.action === "discord.issue" ? await authStore.issueGrant(input.identity, now)
      : input.action === "discord.consume" ? await authStore.consumeGrant(input.key!, now) : null;
    return Response.json({ value });
  } };
  let roomData: unknown;
  const roomApi = createRoomApi({ async get() { return roomData; }, async put(value) { roomData = structuredClone(value); } });
  const env = { TRIAL_MODE: "off", DISCORD_CLIENT_ID: "123456", DISCORD_CLIENT_SECRET: "secret", DISCORD_REDIRECT_URI: "https://example.test/api/discord/callback",
    TRIAL_GATE: { idFromName: () => "gate", get: () => gate }, ROOMS: { idFromName: (code: string) => code, get: () => roomApi } } as any;
  vi.stubGlobal("fetch", async (url: string) => url.endsWith("/oauth2/token") ? Response.json({ access_token: "temporary", token_type: "Bearer" }) : Response.json({ id: "123456789012345678", username: "host", avatar: null }));
  async function authenticate(next: string) {
    const start = await worker.fetch(new Request(`https://example.test/api/discord/start?next=${encodeURIComponent(next)}`), env);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const callback = await worker.fetch(new Request(`https://example.test/api/discord/callback?state=${state}&code=abc`, { headers: { cookie } }), env);
    return callback.headers.getSetCookie().find(value => value.startsWith("wf_discord="))!.split(";")[0]!;
  }
  const firstGrant = await authenticate("/");
  const created = await worker.fetch(new Request("https://example.test/api/rooms", { method: "POST", headers: { cookie: firstGrant, "x-wf-use-discord": "1" }, body: JSON.stringify({ capacity: 10, answerSeconds: 60, scoreMode: "none" }) }), env);
  expect(created.status).toBe(201);
  const createdBody = await created.json() as { roomCode: string };
  const hostCookie = created.headers.getSetCookie().find(value => value.startsWith("wf_session="))!.split(";")[0]!;
  const secondGrant = await authenticate(`/?room=${createdBody.roomCode}`);
  const recovered = await worker.fetch(new Request(`https://example.test/api/rooms/${createdBody.roomCode}/join`, { method: "POST", headers: { cookie: secondGrant, "x-wf-use-discord": "1" }, body: JSON.stringify({ name: "host" }) }), env);
  expect(recovered.status).toBe(200);
  expect(recovered.headers.getSetCookie().find(value => value.startsWith("wf_session="))!.split(";")[0]).toBe(hostCookie);
  expect(await recovered.json()).toMatchObject({ snapshot: { role: "host", room: { participants: [] } } });
});
