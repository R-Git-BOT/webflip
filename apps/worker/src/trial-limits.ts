import type { RoomStore } from "./room-api";
type Action = "refresh" | "command" | "join" | "create" | "blobRead" | "blobWrite";
type Ledger = { day: number; used: number; roomUntil: number; roomCode?: string; blobRead?: number; blobWrite?: number; windows: Record<string, { start: number; used: number }> };
export function createTrialLimits(store: RoomStore, options = { dailyRequests: 10000 }) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.then(operation);
    queue = pending.catch(() => undefined);
    return pending;
  };
  return {
    admit(action: Action, actor: string, now: number, roomCode?: string) {
      return serial(async () => {
        const old = await store.get() as Ledger | undefined;
        const day = Math.floor(now / 86400000);
        const ledger: Ledger = old?.day === day ? structuredClone(old) : { day, used: 0, roomUntil: old?.roomUntil ?? 0, windows: {} };
        if (old?.roomCode && !ledger.roomCode) ledger.roomCode = old.roomCode;
        if (action === "blobRead" || action === "blobWrite") {
          const limit = action === "blobRead" ? 10000 : 1000;
          if ((ledger[action] ?? 0) >= limit) return { allowed: false, reason: "storage_daily_limit", retryAfter: 86400 };
          ledger[action] = (ledger[action] ?? 0) + 1;
          await store.put(ledger);
          return { allowed: true, reason: "accepted", retryAfter: 0 };
        }
        if (ledger.used >= options.dailyRequests) return { allowed: false, reason: "daily_limit", retryAfter: Math.ceil(((day + 1) * 86400000 - now) / 1000) };
        const period = action === "create" ? 600000 : 60000;
        const maximum = { refresh: 10, command: 120, join: 20, create: 5 }[action];
        for (const [key, window] of Object.entries(ledger.windows)) if (now - window.start >= 600000) delete ledger.windows[key];
        const key = `${action}:${actor}`;
        const previous = ledger.windows[key];
        const window = previous && now - previous.start < period ? previous : { start: now, used: 0 };
        if (window.used >= maximum || (!previous && Object.keys(ledger.windows).length >= 1000)) return { allowed: false, reason: "rate_limited", retryAfter: 60 };
        if (action === "create" && ledger.roomUntil > now) return { allowed: false, reason: "trial_room_busy", retryAfter: 60 };
        window.used++;
        ledger.windows[key] = window;
        ledger.used++;
        if (action === "create") { ledger.roomUntil = now + 7500000; ledger.roomCode = roomCode ?? actor; }
        await store.put(ledger);
        return { allowed: true, reason: "accepted", retryAfter: 0 };
      });
    },
    releaseRoom(roomCode?: string) {
      return serial(async () => {
        const ledger = await store.get() as Ledger | undefined;
        if (ledger && (roomCode === undefined || roomCode === ledger.roomCode)) await store.put({ ...ledger, roomUntil: 0 });
      });
    }
  };
}
