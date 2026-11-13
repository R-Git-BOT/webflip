import { expect, it } from "vitest";
import { createRoomApi } from "../src/room-api";

it("uses a trusted Discord identity to recover the same room session", async () => {
  let state: unknown;
  const api = createRoomApi({ async get() { return state; }, async put(value) { state = structuredClone(value); } });
  const post = (path: string, body: unknown, identity?: object) => api.fetch(new Request(`https://ABC234${path}`, { method: "POST", headers: identity ? { "x-wf-discord-identity": encodeURIComponent(JSON.stringify(identity)) } : {}, body: JSON.stringify(body) }));
  const host = await post("/api/rooms", { capacity: 10, answerSeconds: 60, scoreMode: "none" });
  expect(host.status).toBe(201);
  const identity = { id: "123456789012345678", displayName: "Discord名", avatar: "abcdef" };
  const first = await post("/api/rooms/ABC234/join", { name: "ルーム名" }, identity);
  const second = await post("/api/rooms/ABC234/join", { name: "別名" }, identity);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(second.headers.get("set-cookie")).toBe(first.headers.get("set-cookie"));
  const data = await second.json() as { snapshot: { room: { participants: { name: string; avatarUrl?: string }[] } } };
  expect(data.snapshot.room.participants).toHaveLength(1);
  expect(data.snapshot.room.participants[0]).toMatchObject({ name: "ルーム名", avatarUrl: "https://cdn.discordapp.com/avatars/123456789012345678/abcdef.png?size=128" });
});
