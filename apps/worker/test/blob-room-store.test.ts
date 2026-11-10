import { expect, it } from "vitest";
import { createBlobRoomStore } from "../src/blob-room-store";
import { createLocalRoomService } from "../../../packages/runtime/src/index";

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
