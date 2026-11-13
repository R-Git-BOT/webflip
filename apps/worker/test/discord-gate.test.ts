import { afterEach, expect, it, vi } from "vitest";
import { TrialGateDurableObject } from "../src/trial-gate";

afterEach(() => vi.useRealTimers());
it("removes abandoned Discord grants when their expiry alarm runs", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  const values = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    async get(key: string) { return structuredClone(values.get(key)); },
    async put(key: string, value: unknown) { values.set(key, structuredClone(value)); },
    async delete(key: string) { values.delete(key); },
    async setAlarm(value: number) { alarm = value; },
    async deleteAlarm() { alarm = null; }
  };
  const gate = new TrialGateDurableObject({ storage } as unknown as DurableObjectState);
  const response = await gate.fetch(new Request("https://gate/discord", { method: "POST", body: JSON.stringify({ action: "discord.issue", identity: { id: "123", displayName: "名前", avatar: null } }) }));
  const token = ((await response.json()) as { value: string }).value;
  expect(alarm).toBe(301000);
  vi.setSystemTime(301000);
  await gate.alarm();
  expect(values.has("discord-auth")).toBe(false);
  expect(alarm).toBeNull();
  const read = await gate.fetch(new Request("https://gate/discord", { method: "POST", body: JSON.stringify({ action: "discord.read", key: token }) }));
  expect(await read.json()).toEqual({ value: null });
});
