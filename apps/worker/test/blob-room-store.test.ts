import { expect, it } from "vitest";
import { createBlobRoomStore } from "../src/blob-room-store";
import { createLocalRoomService } from "../../../packages/runtime/src/index";

it("ends a cold room and removes its drawings even when R2 reads are unavailable", async () => {
  let value: unknown;
  const blobs = new Map<string, string>();
  let failReads = false;
  const metadata = { async get() { return structuredClone(value); }, async put(next: unknown) { value = structuredClone(next); } };
  const bucket = {
    async put(key: string, data: string) { blobs.set(key, data); },
    async get(key: string) { if (failReads) throw Error("unavailable"); const data = blobs.get(key); return data === undefined ? null : { async text() { return data; } }; },
    async delete(key: string) { blobs.delete(key); }
  };
  const service = createLocalRoomService({ nextId: () => crypto.randomUUID(), nextRoomCode: () => "ABC234" });
  const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" }, { id: "123456789012345678", displayName: "ホスト", avatar: null });
  const guest = service.joinRoom({ roomCode: "ABC234", name: "太郎", discord: { id: "987654321098765432", displayName: "太郎", avatar: null } });
  service.dispatch(host.sessionId, { type: "round.start", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: false });
  service.dispatch(guest.sessionId, { type: "draft.save", drawing: { operations: [{ kind: "clear" }] } });
  await createBlobRoomStore(metadata, bucket).put(service.exportState());
  failReads = true;
  const coldStore = createBlobRoomStore(metadata, bucket);
  await coldStore.terminate();
  expect(JSON.stringify(await coldStore.get())).not.toContain("123456789012345678");
  expect(JSON.stringify(await coldStore.get())).not.toContain("987654321098765432");
  expect(await coldStore.get()).toMatchObject({ rooms: [["ABC234", { phase: "ended", participants: [], round: null }]] });
  expect(blobs.size).toBe(0);
});

it("preserves the last saved drawing when metadata commit fails and removes uncommitted blobs", async () => {
  let value: unknown;
  let fail = false;
  const blobs = new Map<string, string>();
  const store = createBlobRoomStore({ async get() { return structuredClone(value); }, async put(next) { if (fail) throw Error("unavailable"); value = structuredClone(next); } }, {
    async put(key, data) { blobs.set(key, data); },
    async get(key) { const data = blobs.get(key); return data === undefined ? null : { async text() { return data; } }; },
    async delete(key) { blobs.delete(key); }
  });
  let id = 0;
  const service = createLocalRoomService({ nextId: () => String(++id), nextRoomCode: () => "ABC234" });
  const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
  const guest = service.joinRoom({ roomCode: "ABC234", name: "太郎" });
  service.dispatch(host.sessionId, { type: "round.start", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: false });
  service.dispatch(guest.sessionId, { type: "draft.save", drawing: { operations: [] } });
  await store.put(service.exportState());
  service.dispatch(guest.sessionId, { type: "draft.save", drawing: { operations: [{ kind: "clear" }] } });
  fail = true;
  await expect(store.put(service.exportState())).rejects.toThrow("unavailable");
  expect(await store.get()).toMatchObject({ rooms: [["ABC234", { round: { answers: [{ drawing: { operations: [] } }] } }]] });
  expect(blobs.size).toBe(1);
});

it("serves repeated room reads from the last committed state when R2 is temporarily unavailable", async () => {
  let value: unknown;
  let failReads = false;
  const blobs = new Map<string, string>();
  const store = createBlobRoomStore({ async get() { return structuredClone(value); }, async put(next) { value = structuredClone(next); } }, {
    async put(key, data) { blobs.set(key, data); },
    async get(key) { if (failReads) throw Error("R2 unavailable"); const data = blobs.get(key); return data === undefined ? null : { async text() { return data; } }; },
    async delete(key) { blobs.delete(key); }
  });
  let id = 0;
  const service = createLocalRoomService({ nextId: () => String(++id), nextRoomCode: () => "ABC234" });
  const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
  const guest = service.joinRoom({ roomCode: "ABC234", name: "太郎" });
  service.dispatch(host.sessionId, { type: "round.start", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: false });
  service.dispatch(guest.sessionId, { type: "draft.save", drawing: { operations: [{ kind: "clear" }] } });
  await store.put(service.exportState());
  failReads = true;
  expect(await store.get()).toMatchObject({ rooms: [["ABC234", { round: { answers: [{ drawing: { operations: [{ kind: "clear" }] } }] } }]] });
});
