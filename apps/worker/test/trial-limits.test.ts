import { expect, it } from "vitest";
import { createTrialLimits } from "../src/trial-limits";

it("exempts authorized dummy bursts while retaining the daily budget and normal refresh limits", async () => {
  let value: unknown;
  const limits = createTrialLimits({ async get() { return value; }, async put(next) { value = structuredClone(next); } }, { dailyRequests: 62 });
  for (let i = 0; i < 50; i++) expect((await limits.admit("refresh", "dummy", 0, "ABC234", true)).allowed).toBe(true);
  for (let i = 0; i < 10; i++) expect((await limits.admit("refresh", "normal", 0)).allowed).toBe(true);
  expect(await limits.admit("refresh", "normal", 0)).toMatchObject({ reason: "rate_limited" });
  await limits.admit("command", "dummy", 0, "ABC234", true);
  await limits.admit("command", "dummy", 0, "ABC234", true);
  expect(await limits.admit("refresh", "dummy", 0, "ABC234", true)).toMatchObject({ allowed: false, reason: "daily_limit" });
});

it("blocks refresh bursts and retains the daily limit after recreation", async () => {
  let value: unknown;
  const store = { async get() { return structuredClone(value); }, async put(next: unknown) { value = structuredClone(next); } };
  let limits = createTrialLimits(store, { dailyRequests: 12 });
  for (let i = 0; i < 10; i++) expect((await limits.admit("refresh", "browser", 0)).allowed).toBe(true);
  expect(await limits.admit("refresh", "browser", 0)).toMatchObject({ allowed: false, reason: "rate_limited" });
  limits = createTrialLimits(store, { dailyRequests: 12 });
  for (let i = 0; i < 2; i++) expect((await limits.admit("command", "browser", 60000)).allowed).toBe(true);
  expect(await limits.admit("command", "browser", 60000)).toMatchObject({ allowed: false, reason: "daily_limit" });
  expect((await limits.admit("command", "browser", 86400000)).allowed).toBe(true);
});

it("allows only one active trial room", async () => {
  let value: unknown;
  const limits = createTrialLimits({ async get() { return value; }, async put(next) { value = structuredClone(next); } });
  expect((await limits.admit("create", "host1", 0)).allowed).toBe(true);
  expect(await limits.admit("create", "host2", 0)).toMatchObject({ allowed: false, reason: "trial_room_busy" });
  await limits.releaseRoom();
  expect((await limits.admit("create", "host2", 0)).allowed).toBe(true);
});

it("reserves the last daily slots atomically and prevents an old room from releasing a new room", async () => {
  let value: unknown;
  let limits = createTrialLimits({ async get() { return structuredClone(value); }, async put(next) { value = structuredClone(next); } }, { dailyRequests: 2 });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => limits.admit("command", String(i), 0)));
  expect(results.filter(result => result.allowed)).toHaveLength(2);
  value = undefined;
  limits = createTrialLimits({ async get() { return structuredClone(value); }, async put(next) { value = structuredClone(next); } });
  await limits.admit("create", "first", 0, "ABC234");
  await limits.releaseRoom("ABC234");
  await limits.admit("create", "second", 0, "DEF234");
  await limits.releaseRoom("ABC234");
  expect(await limits.admit("create", "third", 0, "GHI234")).toMatchObject({ allowed: false, reason: "trial_room_busy" });
});

it("retains the R2 write budget across recreation and resets it only on the next UTC day", async () => {
  let value: unknown;
  const store = { async get() { return structuredClone(value); }, async put(next: unknown) { value = structuredClone(next); } };
  const limits = createTrialLimits(store);
  for (let i = 0; i < 1000; i++) expect((await limits.admit("blobWrite", "storage", 0)).allowed).toBe(true);
  const restored = createTrialLimits(store);
  expect(await restored.admit("blobWrite", "storage", 60000)).toMatchObject({ allowed: false, reason: "storage_daily_limit" });
  expect((await restored.admit("blobRead", "storage", 60000)).allowed).toBe(true);
  expect((await restored.admit("blobWrite", "storage", 86400000)).allowed).toBe(true);
});
