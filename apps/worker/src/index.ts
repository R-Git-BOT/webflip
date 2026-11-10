import { createRoomApi } from "./room-api";
import { createBlobRoomStore } from "./blob-room-store";
import type { PersistedRoomService } from "../../../packages/runtime/src/index";

type Socket = WebSocket;
type State = DurableObjectState;
interface Env {
  ROOMS: DurableObjectNamespace;
  CANVAS: R2Bucket;
  ASSETS: Fetcher;
}

export class RoomDurableObject {
  private readonly store;
  private readonly api;
  constructor(private readonly state: State, env: Env) {
    this.store = createBlobRoomStore({
      get: () => state.storage.get("room"),
      put: value => state.storage.put("room", value)
    }, env.CANVAS);
    this.api = createRoomApi(this.store);
  }
  async fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      if (new URL(request.url).pathname === "/ws") {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
        const cookie = request.headers.get("cookie") ?? "";
        await this.connection(cookie, true);
        const snapshot = await this.snapshot(cookie);
        if (!snapshot) return new Response(null, { status: 401 });
        for (const old of this.state.getWebSockets()) {
          if (old.deserializeAttachment().cookie === cookie) old.close(4001, "replaced_by_new_connection");
        }
        const pair = new WebSocketPair();
        pair[1].serializeAttachment({ cookie });
        this.state.acceptWebSocket(pair[1]);
        pair[1].send(JSON.stringify({ type: "snapshot", snapshot }));
        await this.schedule();
        await this.broadcast();
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
      }
      const response = await this.api.fetch(request);
      if (response.ok && request.method !== "GET") {
        await this.schedule();
        await this.broadcast();
      }
      return response;
    });
  }
  private async schedule() {
    const persisted = await this.store.get() as PersistedRoomService | undefined;
    const room = persisted?.rooms[0]?.[1];
    if (room?.phase === "ended" && room.endedAt !== undefined) await this.state.storage.setAlarm(room.endedAt + 300_000);
    else if (room && room.hostDisconnectedAt !== undefined) await this.state.storage.setAlarm(room.hostDisconnectedAt + 300_000);
    else if (room) await this.state.storage.setAlarm(Math.min(room.phase === "answering" && room.round ? room.round.endsAt : Infinity, (room.lastActivityAt ?? Date.now()) + 7_200_000));
    else await this.state.storage.deleteAlarm();
  }
  private async connection(cookie: string, connected: boolean) {
    return this.api.fetch(new Request("https://internal/internal/connection", { method: "POST", headers: { cookie }, body: JSON.stringify({ connected }) }));
  }
  private async snapshot(cookie: string) {
    const response = await this.api.fetch(new Request("https://internal/api/session", { headers: { cookie } }));
    const data = await response.json() as { snapshot?: unknown };
    return response.ok ? data.snapshot : null;
  }
  private async broadcast() {
    for (const socket of this.state.getWebSockets()) {
      try {
        const snapshot = await this.snapshot(socket.deserializeAttachment().cookie);
        if (snapshot) socket.send(JSON.stringify({ type: "snapshot", snapshot }));
        else socket.close(4001, "session_expired");
      } catch { socket.close(1011, "snapshot_failed"); }
    }
  }
  async alarm() {
    await this.fetch(new Request("https://internal/internal/alarm", { method: "POST" }));
  }
  webSocketMessage() { /* Commands are authenticated HTTP requests. */ }
  async webSocketClose(socket: Socket) {
    await this.state.blockConcurrencyWhile(async () => {
      const cookie = socket.deserializeAttachment().cookie;
      if (this.state.getWebSockets().some(other => other !== socket && other.readyState === 1 && other.deserializeAttachment().cookie === cookie)) return;
      await this.connection(cookie, false);
      await this.schedule();
      await this.broadcast();
    });
  }
  async webSocketError(socket: Socket) { await this.webSocketClose(socket); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/ws") return env.ASSETS.fetch(request);
    if ((url.pathname === "/ws" || !["GET", "HEAD"].includes(request.method)) && request.headers.get("origin") && request.headers.get("origin") !== url.origin) return Response.json({ error: "invalid_origin" }, { status: 403 });
    const create = request.method === "POST" && url.pathname === "/api/rooms";
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const code = create ? Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join("")
      : url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/join$/)?.[1]
        ?? request.headers.get("cookie")?.match(/(?:^|;\s*)wf_room=([A-Z0-9]{6})(?:;|$)/)?.[1];
    if (!code) return Response.json(url.pathname === "/api/session" ? { snapshot: null } : { error: "session_not_found" }, { status: url.pathname === "/api/session" ? 200 : 401 });
    const internalUrl = new URL(request.url);
    internalUrl.hostname = code.toLowerCase();
    const response = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(internalUrl, request));
    if (response.status === 101) return response;
    const result = new Response(response.body, response);
    if (result.ok && (create || url.pathname.endsWith("/join"))) result.headers.append("set-cookie", `wf_room=${code}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200`);
    return result;
  }
};
