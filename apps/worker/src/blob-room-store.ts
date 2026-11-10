import type { PersistedRoomService } from "../../../packages/runtime/src/index";
import type { RoomStore } from "./room-api";
import { createRoomEngine } from "../../../packages/domain/src/index";

export interface BlobBucket {
  put(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<unknown>;
}
type Envelope = { state: PersistedRoomService; drawings: Record<string, string>; garbage?: string[] };
export function createBlobRoomStore(metadata: RoomStore, bucket: BlobBucket) {
  let cached: PersistedRoomService | undefined;
  let envelopeCache: Envelope | undefined;
  let pendingCleanup = false;
  async function cleanup() {
    const envelope = envelopeCache ?? await metadata.get() as Envelope | undefined;
    if (!envelope) return;
    const remaining: string[] = [];
    const retained = new Set(Object.values(envelope.drawings));
    for (const key of envelope.garbage ?? []) {
      if (retained.has(key)) continue;
      try { await bucket.delete(key); } catch { remaining.push(key); }
    }
    pendingCleanup = remaining.length > 0;
    if (remaining.length !== (envelope.garbage?.length ?? 0)) {
      const next = { ...envelope, garbage: remaining };
      try { await metadata.put(next); envelopeCache = next; } catch { pendingCleanup = true; }
    }
  }
  return {
    hasPendingCleanup: () => pendingCleanup,
    cleanup,
    async terminate() {
      const envelope = envelopeCache ?? await metadata.get() as Envelope | undefined;
      if (!envelope) return;
      const state = structuredClone(envelope.state);
      for (const entry of state.rooms) {
        if (entry[1].phase === "ended") continue;
        const engine = createRoomEngine({ roomId: entry[1].roomId, roomCode: entry[1].roomCode, hostId: entry[1].hostId, ...entry[1].settings }, entry[1]);
        engine.dispatch({ type: "room.end", hostId: entry[1].hostId });
        entry[1] = engine.getState();
      }
      state.receipts = {};
      await this.put(state);
    },
    async get() {
      if (cached) return structuredClone(cached);
      const envelope = await metadata.get() as Envelope | undefined;
      if (!envelope) return undefined;
      const state = structuredClone(envelope.state);
      for (const [code, room] of state.rooms) {
        for (const answer of room.round?.answers ?? []) {
          const key = envelope.drawings[`${code}/${answer.participantId}`];
          if (!key) throw new Error("drawing_missing");
          const blob = await bucket.get(key);
          if (!blob) throw new Error("drawing_missing");
          answer.drawing = JSON.parse(await blob.text());
        }
      }
      cached = structuredClone(state);
      envelopeCache = envelope;
      pendingCleanup = Boolean(envelope.garbage?.length);
      return state;
    },
    async put(value: unknown) {
      const previous = envelopeCache ?? await metadata.get() as Envelope | undefined;
      const full = structuredClone(value) as PersistedRoomService;
      const state = structuredClone(full);
      const drawings: Record<string, string> = {};
      const created: string[] = [];
      try {
        for (const [code, room] of state.rooms) {
          for (const answer of room.round?.answers ?? []) {
            const id = `${code}/${answer.participantId}`;
            const oldKey = previous?.drawings[id];
            const data = JSON.stringify(answer.drawing);
            const oldDrawing = cached?.rooms.find(([key]) => key === code)?.[1].round?.answers.find(old => old.participantId === answer.participantId)?.drawing;
            const oldData = oldDrawing ? JSON.stringify(oldDrawing) : oldKey ? await (await bucket.get(oldKey))?.text() : undefined;
            if (oldKey && oldData === data) drawings[id] = oldKey;
            else {
              const key = `${code}/${crypto.randomUUID()}`;
              created.push(key);
              await bucket.put(key, data);
              drawings[id] = key;
            }
            answer.drawing = { operations: [] };
          }
        }
        const retained = new Set(Object.values(drawings));
        const garbage = [...new Set([...(previous?.garbage ?? []), ...Object.values(previous?.drawings ?? {}).filter(key => !retained.has(key))])];
        const next: Envelope = { state, drawings, garbage };
        await metadata.put(next);
        cached = full;
        envelopeCache = next;
        pendingCleanup = garbage.length > 0;
      } catch (error) {
        await Promise.allSettled(created.map(key => bucket.delete(key)));
        throw error;
      }
      await cleanup();
    }
  };
}
