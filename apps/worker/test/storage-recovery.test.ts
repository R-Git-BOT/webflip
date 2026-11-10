import { afterEach, expect, it, vi } from "vitest";
import { createRoomApi } from "../src/room-api";
import { createStorageRecovery } from "../src/storage-recovery";

afterEach(() => vi.useRealTimers());
it("pauses all answers after three seconds of failed storage and resumes with the saved remaining time", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  let value: unknown, health: unknown;
  let available = false;
  const api = createRoomApi({ async get() { return structuredClone(value); }, async put(next) { value = structuredClone(next); } });
  const call = (path: string, body: unknown, cookie = "") => api.fetch(new Request(`https://ABC234${path}`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));
  const created = await call("/api/rooms", { capacity: 10, answerSeconds: 60, scoreMode: "none" });
  const cookie = created.headers.get("set-cookie")!.split(";")[0]!;
  await call("/api/rooms/ABC234/join", { name: "太郎" });
  await call("/api/command", { type: "round.start", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: false }, cookie);
  const recovery = createStorageRecovery({ async get() { return health; }, async put(next) { health = structuredClone(next); } }, api,
    async () => { if (!available) throw Error("unavailable"); }, async () => { throw Error("not expected"); });
  await recovery.failed();
  vi.setSystemTime(4000);
  await recovery.tick();
  const snapshot = async () => (await (await api.fetch(new Request("https://ABC234/api/session", { headers: { cookie } }))).json()) as any;
  expect((await snapshot()).snapshot.room.storagePausedAt).toBe(4000);
  vi.setSystemTime(14000); available = true;
  await recovery.tick();
  expect((await snapshot()).snapshot.room.storagePausedAt).toBeUndefined();
  expect((await snapshot()).snapshot.room.round.endsAt).toBe(71000);
});
