import type { DiscordIdentity } from "./discord-oauth";

type RecordSet = { states: Record<string, { next: string; expires: number }>; grants: Record<string, { identity: DiscordIdentity; expires: number }> };
type Store = { get(): Promise<unknown>; put(value: unknown): Promise<void> };
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
const valid = (key: string) => /^[a-f0-9]{64}$/.test(key);

export function createDiscordAuthStore(store: Store) {
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: (data: RecordSet) => T, now = Date.now()): Promise<T> => {
    const pending = queue.then(async () => {
      const data = structuredClone((await store.get() as RecordSet | undefined) ?? { states: {}, grants: {} });
      for (const [key, item] of Object.entries(data.states)) if (item.expires <= now) delete data.states[key];
      for (const [key, item] of Object.entries(data.grants)) if (item.expires <= now) delete data.grants[key];
      const result = fn(data);
      await store.put(data);
      return result;
    });
    queue = pending.catch(() => undefined);
    return pending;
  };
  return {
    begin(next: string, now: number) { return run(data => { if (Object.keys(data.states).length >= 1000) throw new Error("discord_auth_busy"); const key = randomToken(); data.states[key] = { next, expires: now + 300_000 }; return key; }, now); },
    consumeState(key: string, now: number) { return run(data => { if (!valid(key)) return null; const record = data.states[key]; delete data.states[key]; return record?.next ?? null; }, now); },
    issueGrant(identity: DiscordIdentity, now: number) { return run(data => { if (Object.keys(data.grants).length >= 1000) throw new Error("discord_auth_busy"); const key = randomToken(); data.grants[key] = { identity, expires: now + 300_000 }; return key; }, now); },
    getGrant(key: string, now: number) { return run(data => valid(key) ? data.grants[key]?.identity ?? null : null, now); },
    consumeGrant(key: string, now: number) { return run(data => { if (!valid(key)) return null; const record = data.grants[key]; delete data.grants[key]; return record?.identity ?? null; }, now); },
    revokeGrant(key: string) { return run(data => { delete data.grants[key]; }); },
    cleanup(now: number) { return run(() => undefined, now); }
  };
}
