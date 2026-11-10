import type { PersistedRoomService } from "../../../packages/runtime/src/index";
import type { RoomStore } from "./room-api";

export interface BlobBucket {
  put(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<unknown>;
}
type Envelope = { state: PersistedRoomService; drawings: Record<string, string> };
export function createBlobRoomStore(metadata: RoomStore, bucket: BlobBucket): RoomStore {
  return {
    async get() {
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
      return state;
    },
    async put(value) {
      const previous = await metadata.get() as Envelope | undefined;
      const state = structuredClone(value) as PersistedRoomService;
      const drawings: Record<string, string> = {};
      for (const [code, room] of state.rooms) {
        for (const answer of room.round?.answers ?? []) {
          const id = `${code}/${answer.participantId}`;
          const oldKey = previous?.drawings[id];
          const data = JSON.stringify(answer.drawing);
          const oldBlob = oldKey ? await bucket.get(oldKey) : null;
          if (oldKey && oldBlob && await oldBlob.text() === data) drawings[id] = oldKey;
          else {
            const key = `${code}/${crypto.randomUUID()}`;
            await bucket.put(key, data);
            drawings[id] = key;
          }
          answer.drawing = { operations: [] };
        }
      }
      await metadata.put({ state, drawings } satisfies Envelope);
      const retained = new Set(Object.values(drawings));
      for (const key of Object.values(previous?.drawings ?? {})) {
        if (!retained.has(key)) await bucket.delete(key);
      }
    }
  };
}
