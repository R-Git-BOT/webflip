import { afterEach, expect, it, vi } from "vitest";
import { subscribeToRoom } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("ignores a delayed close from an old subscription after the new connection is open", () => {
  const sockets: EventTarget[] = [];
  class FakeSocket extends EventTarget {
    constructor() { super(); sockets.push(this); }
    close() { /* The transport reports completion later. */ }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { location: { protocol: "https:", host: "quiz.test" }, setTimeout, clearTimeout });
  let connected = false;
  const status = (value: boolean) => { connected = value; };
  const stopOld = subscribeToRoom(() => {}, () => {}, status);
  sockets[0]!.dispatchEvent(new Event("open"));
  stopOld();
  const stopNew = subscribeToRoom(() => {}, () => {}, status);
  sockets[1]!.dispatchEvent(new Event("open"));
  sockets[0]!.dispatchEvent(new Event("close"));
  expect(connected).toBe(true);
  stopNew();
});

it("does not restore connection state or deliver snapshots after a subscription is stopped", () => {
  const sockets: EventTarget[] = [];
  class FakeSocket extends EventTarget {
    constructor() { super(); sockets.push(this); }
    close() {}
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { location: { protocol: "https:", host: "quiz.test" }, setTimeout, clearTimeout });
  let connected = false;
  const received: string[] = [];
  const stop = subscribeToRoom(snapshot => received.push(snapshot.room.roomCode), () => {}, value => { connected = value; });
  stop();
  sockets[0]!.dispatchEvent(new Event("open"));
  sockets[0]!.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "snapshot", snapshot: { room: { roomCode: "OLD234" } } }) }));
  expect(connected).toBe(false);
  expect(received).toEqual([]);
});
