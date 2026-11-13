import { expect, it } from "vitest";
import { createLocalRoomService } from "../src/index";

it("recovers the same Discord participant and rejects them after host exclusion", () => {
  let id = 0;
  const service = createLocalRoomService({ nextId: () => String(++id), nextRoomCode: () => "ABC234" });
  const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
  const identity = { id: "123456789012345678", displayName: "Discord名", avatar: "abcdef" };
  const first = service.joinRoom({ roomCode: "ABC234", name: "ルーム名", discord: identity });
  const restored = service.joinRoom({ roomCode: "ABC234", name: "別の名前", discord: identity });
  expect(restored.sessionId).toBe(first.sessionId);
  const snapshot = service.getSnapshot(restored.sessionId);
  expect(snapshot.room.participants).toHaveLength(1);
  expect(snapshot.room.participants[0]?.name).toBe("ルーム名");
  service.dispatch(host.sessionId, { type: "participant.remove", participantId: snapshot.participantId! });
  expect(() => service.joinRoom({ roomCode: "ABC234", name: "別の名前", discord: identity })).toThrow("participant_excluded");
  const restarted = createLocalRoomService({ nextId: () => String(++id), nextRoomCode: () => "ABC234" }, service.exportState());
  expect(() => restarted.joinRoom({ roomCode: "ABC234", name: "別の名前", discord: identity })).toThrow("participant_excluded");
  service.dispatch(host.sessionId, { type: "room.end" });
  expect(JSON.stringify(service.exportState())).not.toContain(identity.id);
});

it("recovers a Discord host through the same room without creating a participant", () => {
  let id = 0;
  const service = createLocalRoomService({ nextId: () => String(++id), nextRoomCode: () => "ABC234" });
  const identity = { id: "123456789012345678", displayName: "ホスト", avatar: null };
  const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" }, identity);
  const recovered = service.joinRoom({ roomCode: "ABC234", name: "ホスト", discord: identity });
  expect(recovered.sessionId).toBe(host.sessionId);
  expect(service.getSnapshot(recovered.sessionId).role).toBe("host");
  expect(service.getSnapshot(recovered.sessionId).room.participants).toHaveLength(0);
});
