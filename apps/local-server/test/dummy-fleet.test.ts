import { expect, it } from "vitest";
import { createDummyFleet, type FleetTransport } from "../src/dummy-fleet";

it("keeps other clients online after a failure and restores the saved session on retry", async () => {
  const callbacks = new Map<string, () => void>();
  const online = new Set<string>();
  let resume!: () => void;
  let joins = 0;
  const fleet = createDummyFleet({
    async join(name) { joins++; return { name, cookie: name }; },
    async save() {},
    async connect(session, disconnected) {
      callbacks.set(session.name, () => { online.delete(session.name); disconnected(); });
      online.add(session.name);
      return { close() { online.delete(session.name); } };
    }
  }, { count: 50, intervalMs: 0, wait: ms => ms === 0 ? Promise.resolve() : new Promise(r => { resume = r; }) });
  await fleet.start();
  callbacks.get("ダミー参加者1")!();
  await Promise.resolve();
  expect(fleet.status().connected).toBe(49);
  resume();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(fleet.status().connected).toBe(50);
  expect(joins).toBe(50);
  await fleet.stop();
});

it("keeps fifty independent participant connections in one fleet", async () => {
  const online = new Set<string>();
  const transport: FleetTransport = {
    async join(name) { return { name, cookie: name }; },
    async connect(session) {
      online.add(session.name);
      return { close() { online.delete(session.name); } };
    },
    async save() {}
  };
  const fleet = createDummyFleet(transport, { count: 50, intervalMs: 0 });
  await fleet.start();
  expect(fleet.status()).toEqual({ requested: 50, connected: 50, failed: 0 });
  expect(online.size).toBe(50);
  await fleet.stop();
  expect(online.size).toBe(0);
});
