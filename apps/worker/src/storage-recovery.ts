import type { RoomStore } from "./room-api";

type Health = { failedAt: number };
/** Durable recovery state; external probes run only on bounded alarm retries. */
export function createStorageRecovery(
  health: RoomStore,
  api: { fetch(request: Request): Promise<Response> },
  probe: () => Promise<void>,
  terminate: () => Promise<void>
) {
  const availability = async (available: boolean) => {
    const response = await api.fetch(new Request("https://internal/internal/storage", { method: "POST", body: JSON.stringify({ available }) }));
    if (!response.ok) throw Error("storage_unavailable");
  };
  return {
    async failed() {
      if (!await health.get()) await health.put({ failedAt: Date.now() });
    },
    async nextAlarm() {
      const value = await health.get() as Health | undefined;
      return value ? Math.max(Date.now() + 1000, Math.min(value.failedAt + 60000, value.failedAt + 3000 > Date.now() ? value.failedAt + 3000 : Date.now() + 3000)) : Infinity;
    },
    async tick() {
      const value = await health.get() as Health | undefined;
      if (!value) return;
      if (Date.now() >= value.failedAt + 60000) {
        await terminate();
        await health.put(undefined);
        return;
      }
      try {
        if (Date.now() >= value.failedAt + 3000) await availability(false);
        await probe();
        await availability(true);
        await health.put(undefined);
      } catch { /* Retry via a durable alarm, never a request loop. */ }
    }
  };
}
