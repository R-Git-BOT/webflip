import { expect, it } from "vitest";
import { createDiscordAuthHttp } from "../src/discord-auth-http";
import { createDiscordAuthStore } from "../src/discord-auth-store";

it("binds the callback to its browser, uses state once, and gives an opaque identity grant", async () => {
  let data: unknown;
  const store = createDiscordAuthStore({ async get() { return data; }, async put(v) { data = structuredClone(v); } });
  const auth = createDiscordAuthHttp(store, {
    authorizeUrl: state => `https://discord.com/oauth2/authorize?state=${state}`,
    exchange: async () => ({ id: "123", displayName: "名前", avatar: null })
  });
  const start = await auth.start(new Request("https://example.test/api/discord/start?next=%2F%3Froom%3DABC234"), 1000);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
  expect((await auth.callback(new Request(`https://example.test/api/discord/callback?state=${state}&code=code`), 2000)).status).toBe(400);
  expect((await auth.callback(new Request(`https://example.test/api/discord/callback?state=${state}&code=code&iss=https%3A%2F%2Fevil.test`, { headers: { cookie } }), 2000)).status).toBe(400);
  const callback = await auth.callback(new Request(`https://example.test/api/discord/callback?state=${state}&code=code`, { headers: { cookie } }), 2001);
  expect(callback.status).toBe(303);
  expect(callback.headers.get("location")).toBe("/?room=ABC234");
  const grant = callback.headers.getSetCookie().find(value => value.startsWith("wf_discord="))!;
  expect(grant).toMatch(/HttpOnly; Secure; SameSite=Lax/);
  expect(grant).toMatch(/^wf_discord=[a-f0-9]{64};/);
  expect((await auth.callback(new Request(`https://example.test/api/discord/callback?state=${state}&code=code`, { headers: { cookie } }), 2002)).status).toBe(400);
});
