import { expect, it } from "vitest";
import { createRoomApi } from "../src/room-api";
import { createBlobRoomStore } from "../src/blob-room-store";
import worker, { RoomDurableObject } from "../src/index";

class FakeStore {
  value: unknown;
  async get() { return structuredClone(this.value); }
  async put(value: unknown) { this.value = structuredClone(value); }
}

it("removes disconnected sessions using live connection presence rather than an outdated roster flag", async () => {
  const connected = new Set<string>();
  const api = createRoomApi(new FakeStore(), { isSessionConnected: id => connected.has(id) });
  const call = (path: string, body: unknown, cookie = "") => api.fetch(new Request(`https://ABC234${path}`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));
  const host = (await call("/api/rooms", { capacity: 50, answerSeconds: 60, scoreMode: "none" })).headers.get("set-cookie")!.split(";")[0]!;
  const active = (await call("/api/rooms/ABC234/join", { name: "接続中" })).headers.get("set-cookie")!.split(";")[0]!;
  await call("/api/rooms/ABC234/join", { name: "接続できなかった人" });
  connected.add(active.split("=")[1]!);
  const response = await call("/api/command", { type: "participants.removeDisconnected" }, host);
  expect(response.status).toBe(200);
  const value = await response.json() as { snapshot: { room: { participants: { name: string }[] } } };
  expect(value.snapshot.room.participants.map(p => p.name)).toEqual(["接続中"]);
});

it("corrects stale participant presence when the host refreshes the room", async () => {
  const connected = new Set<string>();
  const api = createRoomApi(new FakeStore(), { isSessionConnected: id => connected.has(id) });
  const post = (path: string, body: unknown) => api.fetch(new Request(`https://ABC234${path}`, { method: "POST", body: JSON.stringify(body) }));
  const created = await post("/api/rooms", { capacity: 50, answerSeconds: 60, scoreMode: "none" });
  const cookie = created.headers.get("set-cookie")!.split(";")[0]!;
  const joined = await post("/api/rooms/ABC234/join", { name: "再接続した人" });
  connected.add(joined.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!);
  await post("/api/rooms/ABC234/join", { name: "接続できなかった人" });
  const response = await api.fetch(new Request("https://ABC234/api/session", { headers: { cookie } }));
  const data = await response.json() as { snapshot: { room: { participants: { name: string; connected: boolean }[] } } };
  expect(data.snapshot.room.participants).toMatchObject([{ name: "再接続した人", connected: true }, { name: "接続できなかった人", connected: false }]);
});

it.each([10, 15, 20, 25, 30, 35, 40, 45, 50])("allows capacity %i through the room creation API", async capacity => {
  const response = await createRoomApi(new FakeStore()).fetch(new Request("https://ABC234/api/rooms", {
    method: "POST", body: JSON.stringify({ capacity, answerSeconds: 60, scoreMode: "none" })
  }));
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ snapshot: { room: { settings: { capacity } } } });
});

it("admits fifty participants, rejects the fifty-first and includes all fifty answers", async () => {
  const api = createRoomApi(new FakeStore());
  const call = (path: string, body: unknown, cookie = "") => api.fetch(new Request(`https://ABC234${path}`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));
  const created = await call("/api/rooms", { capacity: 50, answerSeconds: 60, scoreMode: "none" });
  const host = created.headers.get("set-cookie")!.split(";")[0]!;
  const joined = await Promise.all(Array.from({ length: 51 }, (_, i) => call("/api/rooms/ABC234/join", { name: `参加者${i + 1}` })));
  expect(joined.filter(response => response.ok)).toHaveLength(50);
  expect(await joined[50]!.json()).toEqual({ error: "room_full" });
  await call("/api/command", { type: "round.start", prompt: "50人で回答", answerSeconds: 60, revealNamesDuringJudging: true }, host);
  const submitted = await call("/api/command", { type: "round.close" }, host);
  const result = await submitted.json() as { snapshot: { room: { phase: string; round: { answers: unknown[] } } } };
  expect(result.snapshot.room.phase).toBe("judging");
  expect(result.snapshot.room.round.answers).toHaveLength(50);
});

it("returns a controlled unavailable response when stored room data cannot be loaded", async () => {
  const api = createRoomApi({ async get() { throw Error("R2 unavailable"); }, async put() {} });
  const response = await api.fetch(new Request("https://ABC234/api/session"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "storage_unavailable" });
});

it("returns an empty session and expires cookies after a room session is gone", async () => {
  const response = await createRoomApi(new FakeStore()).fetch(new Request("https://ABC234/api/session", { headers: { cookie: "wf_session=expired" } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ snapshot: null });
  expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([expect.stringContaining("Max-Age=0")]));
});

it("serves session reads without requiring a storage write", async () => {
  const store = new FakeStore();
  const api = createRoomApi(store);
  const created = await api.fetch(new Request("https://ABC234/api/rooms", { method: "POST", body: JSON.stringify({ capacity: 10, answerSeconds: 60, scoreMode: "none" }) }));
  const cookie = created.headers.get("set-cookie")!.split(";")[0]!;
  store.put = async () => { throw new Error("storage_write_unavailable"); };
  const response = await api.fetch(new Request("https://ABC234/api/session", { headers: { cookie } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ snapshot: { role: "host" } });
});

it("routes Worker requests to a Durable Object and preserves the session after object recreation", async () => {
  const data = new Map<string, unknown>();
  const state = {
    storage: {
      async get<T>(key: string) { return structuredClone(data.get(key)) as T | undefined; },
      async put(key: string, value: unknown) { data.set(key, structuredClone(value)); },
      async setAlarm() {}, async deleteAlarm() {}
    },
    acceptWebSocket() {}, getWebSockets() { return []; },
    async blockConcurrencyWhile<T>(callback: () => Promise<T>) { return callback(); }
  };
  const env = {
    TRIAL_MODE: "off",
    CANVAS: { async put() {}, async get() { return null; }, async delete() {} },
    ASSETS: { async fetch() { return new Response("static"); } },
    ROOMS: { idFromName(name: string) { return name; }, get() { return { fetch: (request: Request) => object.fetch(request) }; } }
  };
  let object = new RoomDurableObject(state, env);
  const created = await worker.fetch(new Request("https://quiz.test/api/rooms", { method: "POST", body: JSON.stringify({ capacity: 10, answerSeconds: 60, scoreMode: "none" }) }), env);
  expect(created.status).toBe(201);
  const cookies = created.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  object = new RoomDurableObject(state, env);
  const restored = await worker.fetch(new Request("https://quiz.test/api/session", { headers: { cookie: cookies } }), env);
  expect(await restored.json()).toMatchObject({ snapshot: { role: "host", room: { phase: "waiting" } } });
});

it("restores a created room and its host session after runtime recreation", async () => {
  const store = new FakeStore();
  const api = createRoomApi(store);
  const response = await api.fetch(new Request("https://quiz.test/api/rooms", {
    method: "POST", body: JSON.stringify({ capacity: 10, answerSeconds: 60, scoreMode: "none" })
  }));
  expect(response.status).toBe(201);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const restored = createRoomApi(store);
  const snapshot = await restored.fetch(new Request("https://quiz.test/api/session", { headers: { cookie } }));
  expect(await snapshot.json()).toMatchObject({ snapshot: { role: "host", room: { phase: "waiting" } } });
});

it("rejects unknown and privileged domain commands at the HTTP boundary", async () => {
  const api = createRoomApi(new FakeStore());
  const created = await api.fetch(new Request("https://ABC234/api/rooms", { method: "POST", body: JSON.stringify({ capacity: 10, answerSeconds: 60, scoreMode: "none" }) }));
  const joined = await api.fetch(new Request("https://ABC234/api/rooms/ABC234/join", { method: "POST", body: JSON.stringify({ name: "たろう" }) }));
  const cookie = joined.headers.get("set-cookie")!.split(";")[0]!;
  const response = await api.fetch(new Request("https://ABC234/api/command", { method: "POST", headers: { cookie }, body: JSON.stringify({ type: "participant.join", name: "injected" }) }));
  expect(response.status).toBe(400);
});

it("rejects malformed PNG data instead of confirming an answer", async () => {
  const api = createRoomApi(new FakeStore());
  const call = (path: string, body: unknown, cookie?: string) => api.fetch(new Request(`https://ABC234${path}`, { method: "POST", headers: cookie ? { cookie } : {}, body: JSON.stringify(body) }));
  const created = await call("/api/rooms", { capacity: 10, answerSeconds: 60, scoreMode: "none" });
  const host = created.headers.get("set-cookie")!.split(";")[0]!;
  const joined = await call("/api/rooms/ABC234/join", { name: "太郎" });
  const guest = joined.headers.get("set-cookie")!.split(";")[0]!;
  await call("/api/command", { type: "round.start", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: false }, host);
  const response = await call("/api/command", { type: "answer.confirm", drawing: { operations: [], pngDataUrl: "data:image/png;base64,AAAA" } }, guest);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_png" });
});

it("does not toggle a correct answer twice when the same command is retried", async () => {
  const api = createRoomApi(new FakeStore());
  const call = (path: string, body?: unknown, cookie?: string) => api.fetch(new Request(`https://ABC234${path}`, { method: body === undefined ? "GET" : "POST", headers: cookie ? { cookie } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const created = await call("/api/rooms", { capacity: 10, answerSeconds: 60, scoreMode: "none" });
  const host = created.headers.get("set-cookie")!.split(";")[0]!;
  const joined = await call("/api/rooms/ABC234/join", { name: "太郎" });
  const guest = joined.headers.get("set-cookie")!.split(";")[0]!;
  const participantId = (await joined.json() as { snapshot: { participantId: string } }).snapshot.participantId;
  await call("/api/command", { type: "round.start", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: false }, host);
  await call("/api/command", { type: "answer.confirm", drawing: { operations: [] } }, guest);
  const command = { type: "answer.toggleCorrect", participantId, commandId: "same-command" };
  await call("/api/command", command, host);
  await call("/api/command", command, host);
  expect(await (await call("/api/session", undefined, host)).json()).toMatchObject({ snapshot: { room: { round: { correctParticipantIds: [participantId] } } } });
});

it("keeps drawings through instance recreation and removes old drawings on next round", async () => {
  const metadata = new FakeStore();
  const blobs = new Map<string, string>();
  const bucket = {
    async put(key: string, value: string) { blobs.set(key, value); },
    async get(key: string) { const value = blobs.get(key); return value === undefined ? null : { async text() { return value; } }; },
    async delete(key: string) { blobs.delete(key); }
  };
  const store = createBlobRoomStore(metadata, bucket);
  let api = createRoomApi(store);
  const call = (path: string, body?: unknown, cookie?: string) => api.fetch(new Request(`https://ABC234${path}`, {
    method: body === undefined ? "GET" : "POST", headers: cookie ? { cookie } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }));
  const created = await call("/api/rooms", { capacity: 10, answerSeconds: 60, scoreMode: "none" });
  const host = created.headers.get("set-cookie")!.split(";")[0]!;
  const joined = await call("/api/rooms/ABC234/join", { name: "たろう" });
  const participant = joined.headers.get("set-cookie")!.split(";")[0]!;
  await call("/api/command", { type: "round.start", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: false }, host);
  const drawing = { operations: [{ kind: "stroke", points: [[10,20], [30,40]] }] };
  await call("/api/command", { type: "answer.confirm", drawing }, participant);
  api = createRoomApi(createBlobRoomStore(metadata, bucket));
  expect(await (await call("/api/session", undefined, participant)).json()).toMatchObject({ snapshot: { room: { phase: "judging", round: { answers: [{ drawing }] } } } });
  await call("/api/command", { type: "results.publish" }, host);
  await call("/api/command", { type: "round.next" }, host);
  expect(blobs.size).toBe(0);
});
