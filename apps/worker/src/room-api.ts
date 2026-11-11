import { createLocalRoomService, type PersistedRoomService, type LocalCommand } from "../../../packages/runtime/src/index";
import { validatePngDataUrl } from "./png";
import { isRoomCapacity } from "../../../packages/domain/src/index";

export interface RoomStore {
  get(): Promise<unknown>;
  put(value: unknown): Promise<void>;
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, { status, headers });

export function createRoomApi(store: RoomStore, options: { requirePng?: boolean; isSessionConnected?: (id: string) => boolean } = {}) {
  let queue: Promise<unknown> = Promise.resolve();
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)wf_session=([^;]+)/)?.[1];
    let persisted: PersistedRoomService | undefined;
    try { persisted = await store.get() as PersistedRoomService | undefined; }
    catch { return json({ error: "storage_unavailable" }, 503); }
    const receipts = structuredClone(persisted?.receipts ?? {});
    const service = createLocalRoomService({
      nextId: () => crypto.randomUUID(),
      nextRoomCode: () => url.hostname.toUpperCase()
    }, persisted);
    const sessionCookie = (id: string) => ({ "set-cookie": `wf_session=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${id ? 7200 : 0}` });
    try {
      let response: Response;
      const expired = service.expireDueRounds(Date.now()).length > 0;
      let presenceChanged = false;
      const syncPresence = () => {
        if (!options.isSessionConnected || expired) return;
        for (const [id, session] of persisted?.sessions ?? []) {
          if (session.role !== "participant") continue;
          const participant = persisted?.rooms.find(([code]) => code === session.roomCode)?.[1].participants.find(p => p.id === session.participantId && !p.left);
          const connected = options.isSessionConnected(id);
          if (participant && participant.connected !== connected) {
            service.setConnection(id, connected, Date.now());
            presenceChanged = true;
          }
        }
      };
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        if (service.exportState().rooms.length) return json({ error: "room_exists" }, 409);
        const input = await request.json() as { capacity: number; answerSeconds: number; scoreMode: "none" | "correct-count" };
        if (!isRoomCapacity(input.capacity) || ![30,60,90,120,180].includes(input.answerSeconds) || !["none", "correct-count"].includes(input.scoreMode)) throw new Error("invalid_settings");
        const created = service.createRoom(input);
        if (options.isSessionConnected) service.setConnection(created.sessionId, false, Date.now());
        response = json({ roomCode: created.roomCode, snapshot: service.getSnapshot(created.sessionId) }, 201, sessionCookie(created.sessionId));
      } else if (request.method === "POST" && /\/api\/rooms\/[A-Z0-9]{6}\/join$/.test(url.pathname)) {
        const input = await request.json() as { name: string };
        const joined = service.joinRoom({ roomCode: url.pathname.split("/")[3]!, name: input.name, ...(cookie ? { previousSessionId: cookie } : {}) });
        if (options.isSessionConnected) service.setConnection(joined.sessionId, false, Date.now());
        response = json({ snapshot: service.getSnapshot(joined.sessionId) }, 200, sessionCookie(joined.sessionId));
      } else if (request.method === "POST" && url.pathname === "/internal/connection") {
        if (!cookie) return json({ error: "session_not_found" }, 401);
        const input = await request.json() as { connected: boolean };
        service.setConnection(cookie, input.connected, Date.now());
        response = json({ ok: true });
      } else if (request.method === "POST" && url.pathname === "/internal/storage") {
        const input = await request.json() as { available: boolean };
        service.setStorageAvailability(input.available, Date.now());
        response = json({ ok: true });
      } else if (request.method === "POST" && url.pathname === "/internal/alarm") {
        response = json({ ok: true });
      } else if (request.method === "GET" && url.pathname === "/api/session") {
        if (cookie && persisted?.blockedSessions?.[cookie]) return json({ error: "participant_excluded" }, 403);
        syncPresence();
        let snapshot = null;
        try { snapshot = cookie ? service.getSnapshot(cookie) : null; } catch { /* Expired and removed sessions return to the entry screen. */ }
        response = json({ snapshot });
        if (cookie && !snapshot) {
          response.headers.append("set-cookie", "wf_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
          response.headers.append("set-cookie", "wf_room=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
        }
      } else if (request.method === "POST" && url.pathname === "/api/command") {
        if (!cookie) return json({ error: "session_not_found" }, 401);
        const command = await request.json() as LocalCommand & { commandId?: string; roundToken?: number | null };
        if (command.commandId !== undefined && (typeof command.commandId !== "string" || command.commandId.length > 100)) throw new Error("invalid_command");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(command)));
        const fingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
        const receiptKey = command.commandId ? `${cookie}:${command.commandId}` : undefined;
        if (receiptKey && receipts[receiptKey]) {
          if (receipts[receiptKey].fingerprint !== fingerprint) throw new Error("command_conflict");
          return json({ snapshot: service.getSnapshot(cookie) });
        }
        if (command.roundToken !== undefined && command.roundToken !== (service.getSnapshot(cookie).room.round?.startedAt ?? null)) throw new Error("stale_round");
        if (!command || !["host.activity", "participants.removeDisconnected", "participant.remove", "round.start", "draft.save", "answer.confirm", "answer.reopen", "answer.toggleCorrect", "results.publish", "round.next", "round.close", "room.end"].includes(command.type)) throw new Error("invalid_command");
        if (command.type === "participants.removeDisconnected" && options.isSessionConnected) {
          if (service.getSnapshot(cookie).role !== "host") throw new Error("host_required");
          syncPresence();
        }
        if (command.type === "round.start") {
          if (typeof command.prompt !== "string" || typeof command.revealNamesDuringJudging !== "boolean") throw new Error("invalid_command");
          command.startedAt = Date.now();
        }
        if ((command.type === "answer.toggleCorrect" || command.type === "participant.remove") && typeof command.participantId !== "string") throw new Error("invalid_command");
        if (command.type === "draft.save" || command.type === "answer.confirm") {
          if (!command.drawing || !Array.isArray(command.drawing.operations) || JSON.stringify(command.drawing).length > 1_000_000) throw new Error("invalid_drawing");
          const drawing = command.drawing as { operations: unknown[]; redoOperations?: unknown[]; pngDataUrl?: string };
          if (options.requirePng || drawing.pngDataUrl !== undefined) await validatePngDataUrl(drawing.pngDataUrl);
          if (drawing.redoOperations !== undefined && !Array.isArray(drawing.redoOperations)) throw new Error("invalid_drawing");
          for (const entry of [...drawing.operations, ...(drawing.redoOperations ?? [])]) {
            const op = entry as { kind: string; points?: number[][] };
            if (!op || (op.kind !== "clear" && (op.kind !== "stroke" || !Array.isArray(op.points) || !op.points.every(p => Array.isArray(p) && p.length === 2 && p.every((n, i) => Number.isFinite(n) && n >= 0 && n <= (i === 0 ? 1024 : 768)))))) throw new Error("invalid_drawing");
          }
        }
        service.dispatch(cookie, command);
        if (command.type === "round.start" || command.type === "round.next" || command.type === "room.end") for (const key of Object.keys(receipts)) delete receipts[key];
        if (receiptKey) receipts[receiptKey] = { sessionId: cookie, fingerprint };
        response = json({ snapshot: service.getSnapshot(cookie) });
        if (command.type === "draft.save") response.headers.set("x-wf-update", "private-draft");
      } else if (request.method === "POST" && url.pathname === "/api/leave") {
        if (!cookie) return json({ error: "session_not_found" }, 401);
        service.leaveRoom(cookie);
        response = json({ snapshot: null }, 200, sessionCookie(""));
        response.headers.append("set-cookie", "wf_room=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
      } else return json({ error: "not_found" }, 404);
      if (request.method !== "GET" || expired || presenceChanged) {
        const next = service.exportState();
        next.receipts = next.rooms.length ? receipts : {};
        try { await store.put(next); } catch { return json({ error: "storage_unavailable" }, 503); }
      }
      if (cookie) {
        try { response.headers.set("x-wf-phase", service.getSnapshot(cookie).room.phase); } catch { /* A completed leave has no session. */ }
      }
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "request_failed";
      return json({ error: message }, message.endsWith("_not_found") ? 404 : 400);
    }
  }
  return {
    fetch(request: Request): Promise<Response> {
      const pending = queue.then(() => handle(request));
      queue = pending.catch(() => undefined);
      return pending;
    }
  };
}
