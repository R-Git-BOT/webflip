import { createLocalRoomService, type PersistedRoomService, type LocalCommand } from "../../../packages/runtime/src/index";

export interface RoomStore {
  get(): Promise<unknown>;
  put(value: unknown): Promise<void>;
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(value, { status, headers });

export function createRoomApi(store: RoomStore) {
  let queue: Promise<unknown> = Promise.resolve();
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)wf_session=([^;]+)/)?.[1];
    const service = createLocalRoomService({
      nextId: () => crypto.randomUUID(),
      nextRoomCode: () => url.hostname.toUpperCase()
    }, await store.get() as PersistedRoomService | undefined);
    const sessionCookie = (id: string) => ({ "set-cookie": `wf_session=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200` });
    try {
      let response: Response;
      const expired = service.expireDueRounds(Date.now()).length > 0;
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        if (service.exportState().rooms.length) return json({ error: "room_exists" }, 409);
        const input = await request.json() as { capacity: number; answerSeconds: number; scoreMode: "none" | "correct-count" };
        if (!Number.isInteger(input.capacity) || input.capacity < 6 || input.capacity > 15 || ![30,60,90,120,180].includes(input.answerSeconds) || !["none", "correct-count"].includes(input.scoreMode)) throw new Error("invalid_settings");
        const created = service.createRoom(input);
        response = json({ roomCode: created.roomCode, snapshot: service.getSnapshot(created.sessionId) }, 201, sessionCookie(created.sessionId));
      } else if (request.method === "POST" && /\/api\/rooms\/[A-Z0-9]{6}\/join$/.test(url.pathname)) {
        const input = await request.json() as { name: string };
        const joined = service.joinRoom({ roomCode: url.pathname.split("/")[3]!, name: input.name });
        response = json({ snapshot: service.getSnapshot(joined.sessionId) }, 200, sessionCookie(joined.sessionId));
      } else if (request.method === "POST" && url.pathname === "/internal/connection") {
        if (!cookie) return json({ error: "session_not_found" }, 401);
        const input = await request.json() as { connected: boolean };
        service.setConnection(cookie, input.connected, Date.now());
        response = json({ ok: true });
      } else if (request.method === "POST" && url.pathname === "/internal/alarm") {
        response = json({ ok: true });
      } else if (request.method === "GET" && url.pathname === "/api/session") {
        response = json({ snapshot: cookie ? service.getSnapshot(cookie) : null });
      } else if (request.method === "POST" && url.pathname === "/api/command") {
        if (!cookie) return json({ error: "session_not_found" }, 401);
        const command = await request.json() as LocalCommand;
        if (!command || !["round.start", "draft.save", "answer.confirm", "answer.reopen", "answer.toggleCorrect", "results.publish", "round.next", "round.close", "room.end"].includes(command.type)) throw new Error("invalid_command");
        if (command.type === "round.start") {
          if (typeof command.prompt !== "string" || typeof command.revealNamesDuringJudging !== "boolean") throw new Error("invalid_command");
          command.startedAt = Date.now();
        }
        if (command.type === "answer.toggleCorrect" && typeof command.participantId !== "string") throw new Error("invalid_command");
        if (command.type === "draft.save" || command.type === "answer.confirm") {
          if (!command.drawing || !Array.isArray(command.drawing.operations) || JSON.stringify(command.drawing).length > 1_000_000) throw new Error("invalid_drawing");
          const drawing = command.drawing as { operations: unknown[]; redoOperations?: unknown[] };
          if (drawing.redoOperations !== undefined && !Array.isArray(drawing.redoOperations)) throw new Error("invalid_drawing");
          for (const entry of [...drawing.operations, ...(drawing.redoOperations ?? [])]) {
            const op = entry as { kind: string; points?: number[][] };
            if (!op || (op.kind !== "clear" && (op.kind !== "stroke" || !Array.isArray(op.points) || !op.points.every(p => Array.isArray(p) && p.length === 2 && p.every((n, i) => Number.isFinite(n) && n >= 0 && n <= (i === 0 ? 1024 : 768)))))) throw new Error("invalid_drawing");
          }
        }
        service.dispatch(cookie, command);
        response = json({ snapshot: service.getSnapshot(cookie) });
      } else if (request.method === "POST" && url.pathname === "/api/leave") {
        if (!cookie) return json({ error: "session_not_found" }, 401);
        service.leaveRoom(cookie);
        response = json({ snapshot: null }, 200, sessionCookie(""));
      } else return json({ error: "not_found" }, 404);
      if (request.method !== "GET" || expired) await store.put(service.exportState());
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
