import { afterEach, expect, it, vi } from "vitest";
import { createLocalRoomService } from "../src/index";
afterEach(() => vi.useRealTimers());
it("ends a storage outage after one minute even while the host is disconnected", () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const service = createLocalRoomService({ nextId: () => crypto.randomUUID(), nextRoomCode: () => "ABC234" });
  const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
  service.setStorageAvailability(false, 1000);
  service.setConnection(host.sessionId, false, 1000);
  vi.setSystemTime(61000);
  service.expireDueRounds(Date.now());
  expect(service.getSnapshot(host.sessionId).room.phase).toBe("ended");
});
it("keeps a disconnected host's room for five minutes, then ends it", () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  let id = 0;
  const service = createLocalRoomService({ nextId: () => String(++id), nextRoomCode: () => "ABC234" });
  const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
  service.setConnection(host.sessionId, false, 1000);
  service.expireDueRounds(300999);
  expect(service.getSnapshot(host.sessionId).room.phase).toBe("waiting");
  vi.setSystemTime(301000);
  service.expireDueRounds(Date.now());
  expect(service.getSnapshot(host.sessionId).room.phase).toBe("ended");
});
it("ends an abandoned room after two hours and expires its sessions five minutes later", () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  let id = 0;
  const service = createLocalRoomService({ nextId: () => String(++id), nextRoomCode: () => "ABC234" });
  const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
  vi.setSystemTime(7_201_000);
  service.expireDueRounds(Date.now());
  expect(service.getSnapshot(host.sessionId).room.phase).toBe("ended");
  vi.setSystemTime(7_501_000);
  service.expireDueRounds(Date.now());
  expect(() => service.getSnapshot(host.sessionId)).toThrow("session_not_found");
});
