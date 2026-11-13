import { expect, it } from "vitest";
import { createDiscordAuthStore } from "../src/discord-auth-store";

it("uses an expiring, single-use OAuth state and an opaque one-time identity grant", async () => {
  let value: unknown;
  const store = createDiscordAuthStore({ async get() { return value; }, async put(v) { value = structuredClone(v); } });
  const state = await store.begin("/?room=ABC234", 1000);
  expect(state).toMatch(/^[a-f0-9]{64}$/);
  expect(await store.consumeState(state, 1001)).toBe("/?room=ABC234");
  expect(await store.consumeState(state, 1002)).toBeNull();
  const grant = await store.issueGrant({ id: "123", displayName: "名前", avatar: null }, 2000);
  expect(grant).toMatch(/^[a-f0-9]{64}$/);
  expect(await store.getGrant(grant, 2001)).toEqual({ id: "123", displayName: "名前", avatar: null });
  expect(await store.consumeGrant(grant, 2001)).toEqual({ id: "123", displayName: "名前", avatar: null });
  expect(await store.consumeGrant(grant, 2001)).toBeNull();
  await store.revokeGrant(grant);
  expect(await store.getGrant(grant, 2002)).toBeNull();
  const expired = await store.begin("/", 1000);
  expect(await store.consumeState(expired, 301001)).toBeNull();
});
