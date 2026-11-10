import { createRoomApi } from "./room-api";
import { createBlobRoomStore } from "./blob-room-store";
import type { PersistedRoomService } from "../../../packages/runtime/src/index";
import { issueTrialCookie, verifyTrialCookie, verifyTrialCode, trialPage, safeTrialPath } from "./trial-access";
import { createStorageRecovery } from "./storage-recovery";
export { TrialGateDurableObject } from "./trial-gate";

type Socket = WebSocket;
type State = DurableObjectState;
type Env = WorkerBindings;

export class RoomDurableObject {
  private readonly store;
  private readonly api;
  private readonly recovery;
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  constructor(private readonly state: State, private readonly env: Env) {
    const reserve = async (action: "blobRead" | "blobWrite") => {
      if (env.TRIAL_MODE === "off") return;
      if (!env.TRIAL_GATE) throw new Error("storage_daily_limit");
      const gate = env.TRIAL_GATE.get(env.TRIAL_GATE.idFromName("limited-trial"));
      const response = await gate.fetch(new Request("https://gate/storage", { method: "POST", body: JSON.stringify({ action, actor: "storage" }) }));
      if (!response.ok) throw new Error("storage_daily_limit");
    };
    const bucket = {
      async get(key: string) { await reserve("blobRead"); return env.CANVAS.get(key); },
      async put(key: string, value: string) { await reserve("blobWrite"); return env.CANVAS.put(key, value); },
      delete: (key: string) => env.CANVAS.delete(key)
    };
    this.store = createBlobRoomStore({
      get: () => state.storage.get("room"),
      put: async value => {
        const envelope = value as { state: PersistedRoomService; garbage?: string[] };
        if (!envelope.state.rooms.length && !envelope.garbage?.length) await state.storage.delete("room");
        else await state.storage.put("room", value);
      }
    }, bucket);
    this.api = createRoomApi(this.store, { requirePng: env.TRIAL_MODE !== "off" });
    this.recovery = createStorageRecovery({
      get: () => state.storage.get("storage-health"),
      put: async value => { if (value === undefined) await state.storage.delete("storage-health"); else await state.storage.put("storage-health", value); }
    }, this.api, async () => {
      const key = `health/${state.id.toString()}`;
      await bucket.put(key, "{}");
      await bucket.delete(key);
    }, () => this.store.terminate());
  }
  async fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      try { return await this.handle(request); }
      catch { await this.storageFailed(); return Response.json({ error: "storage_unavailable" }, { status: 503 }); }
    });
  }
  private async storageFailed() {
    await this.recovery.failed();
    await this.state.storage.setAlarm(await this.recovery.nextAlarm());
  }
  private async handle(request: Request): Promise<Response> {
      if (new URL(request.url).pathname === "/ws") {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
        const cookie = request.headers.get("cookie") ?? "";
        const connectionId = new URL(request.url).searchParams.get("connection");
        if (!connectionId || connectionId.length > 100) return new Response(null, { status: 400 });
        const restored = await this.connection(cookie, true);
        if (!restored.ok) {
          if (restored.status === 503) await this.storageFailed();
          return restored;
        }
        const snapshot = await this.snapshot(cookie);
        if (!snapshot) return new Response(null, { status: 401 });
        for (const old of this.state.getWebSockets()) {
          if (old.deserializeAttachment().cookie === cookie) old.close(4001, "replaced_by_new_connection");
        }
        const pair = new WebSocketPair();
        pair[1].serializeAttachment({ cookie, connectionId });
        this.state.acceptWebSocket(pair[1]);
        pair[1].send(JSON.stringify({ type: "snapshot", snapshot }));
        await this.schedule();
        await this.broadcast();
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
      }
      const path = new URL(request.url).pathname;
      if (path === "/api/command" || path === "/api/leave") {
        const cookie = request.headers.get("cookie") ?? "";
        const id = request.headers.get("x-wf-connection");
        if (!this.state.getWebSockets().some(socket => {
          const attachment = socket.deserializeAttachment() as { cookie: string; connectionId?: string };
          return socket.readyState === 1 && attachment.cookie === cookie && id && attachment.connectionId === id;
        })) return Response.json({ error: "connection_required" }, { status: 409 });
      }
      const response = await this.api.fetch(request);
      if (response.status === 503) { await this.storageFailed(); return response; }
      if (response.ok && request.method !== "GET") {
        await this.schedule();
        await this.broadcast(response.headers.get("x-wf-update") === "private-draft" ? request.headers.get("cookie") ?? "" : undefined);
      }
      return response;
  }
  private async schedule() {
    const persisted = await this.store.get() as PersistedRoomService | undefined;
    const room = persisted?.rooms[0]?.[1];
    let deadline = Math.min(await this.recovery.nextAlarm(), this.store.hasPendingCleanup() ? Date.now() + 60000 : Infinity);
    if (room?.phase === "ended" && room.endedAt !== undefined) {
      deadline = Math.min(deadline, room.endedAt + 300000);
      if (this.env.TRIAL_MODE !== "off") {
        const gate = this.env.TRIAL_GATE.get(this.env.TRIAL_GATE.idFromName("limited-trial"));
        await gate.fetch(new Request("https://gate/release", { method: "POST", body: JSON.stringify({ action: "release", actor: "alarm", roomCode: room.roomCode }) }));
      }
    } else if (room) {
      deadline = Math.min(deadline, (room.createdAt ?? Date.now()) + 7200000,
        room.hostDisconnectedAt !== undefined ? room.hostDisconnectedAt + 300000 : Infinity,
        room.storagePausedAt !== undefined ? room.storagePausedAt + 60000 : Infinity);
      if (room.hostDisconnectedAt === undefined && room.storagePausedAt === undefined) deadline = Math.min(deadline,
        room.phase === "answering" && room.round ? room.round.endsAt : Infinity,
        (room.lastActivityAt ?? Date.now()) + 7200000);
    }
    if (deadline < Infinity) await this.state.storage.setAlarm(Math.max(Date.now() + 100, deadline));
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
  private async broadcast(onlyCookie?: string) {
    for (const socket of this.state.getWebSockets()) {
      if (onlyCookie !== undefined && socket.deserializeAttachment().cookie !== onlyCookie) continue;
      try {
        const snapshot = await this.snapshot(socket.deserializeAttachment().cookie);
        if (snapshot) socket.send(JSON.stringify({ type: "snapshot", snapshot }));
        else socket.close(4001, "session_expired");
      } catch { socket.close(1011, "snapshot_failed"); }
    }
  }
  async alarm() {
    await this.serial(async () => {
      try {
        await this.recovery.tick();
        await this.store.cleanup();
        await this.handle(new Request("https://internal/internal/alarm", { method: "POST" }));
      } catch { await this.storageFailed(); }
    });
  }
  webSocketMessage(socket: Socket) { socket.close(4008, "http_commands_only"); }
  async webSocketClose(socket: Socket) {
    await this.serial(async () => {
      const cookie = socket.deserializeAttachment().cookie;
      if (this.state.getWebSockets().some(other => other !== socket && other.readyState === 1 && other.deserializeAttachment().cookie === cookie)) return;
      try {
        const response = await this.connection(cookie, false);
        if (response.status === 503) await this.storageFailed();
        else { await this.schedule(); await this.broadcast(); }
      } catch { await this.storageFailed(); }
    });
  }
  async webSocketError(socket: Socket) { await this.webSocketClose(socket); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await routeRequest(request, env); }
    catch { return Response.json({ error: "trial_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
  }
};
async function routeRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith("/api/") || url.pathname === "/ws";
    const isTrial = url.pathname === "/trial" || url.pathname === "/trial/login";
    if (!isApi && !isTrial) return env.ASSETS.fetch(request);
    if (env.TRIAL_MODE === "closed") return Response.json({ error: "trial_unavailable" }, { status: 503 });
    if (isApi && !((request.method === "GET" && ["/api/session", "/ws"].includes(url.pathname)) || (request.method === "POST" && (["/api/rooms", "/api/command", "/api/leave"].includes(url.pathname) || /^\/api\/rooms\/[A-Z0-9]{6}\/join$/.test(url.pathname))))) return new Response(null, { status: 404 });
    if ((url.pathname === "/ws" || !["GET", "HEAD"].includes(request.method)) && request.headers.get("origin") && request.headers.get("origin") !== url.origin) return Response.json({ error: "invalid_origin" }, { status: 403 });
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    if (env.REQUEST_LIMITER && !(await env.REQUEST_LIMITER.limit({ key: ip })).success) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });
    if (request.body) {
      const maximum = isTrial ? 1024 : 1_100_000;
      if (Number(request.headers.get("content-length") ?? 0) > maximum) return Response.json({ error: "request_too_large" }, { status: 413 });
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) { await reader.cancel(); return Response.json({ error: "request_too_large" }, { status: 413 }); }
        chunks.push(value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      request = new Request(request, { body });
    }
    const trialEnabled = env.TRIAL_MODE !== "off";
    let actor = ip;
    if (trialEnabled) {
      if (!env.TRIAL_CODE || !env.TRIAL_GATE || !env.REQUEST_LIMITER || !env.LOGIN_LIMITER) return Response.json({ error: "trial_unavailable" }, { status: 503 });
      if (isTrial) {
        if (url.pathname === "/trial" && request.method === "GET") return trialPage(url.searchParams.get("next") ?? "/");
        if (url.pathname !== "/trial/login" || request.method !== "POST") return new Response(null, { status: 405 });
        if (!(await env.LOGIN_LIMITER.limit({ key: ip })).success) return Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });
        const form = new URLSearchParams(await request.text());
        const next = form.get("next") ?? "/";
        if (!await verifyTrialCode(form.get("code") ?? "", env.TRIAL_CODE)) return trialPage(next, true);
        const value = await issueTrialCookie(env.TRIAL_CODE, Date.now());
        return new Response(null, { status: 303, headers: { location: safeTrialPath(next), "set-cookie": `wf_trial=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`, "cache-control": "no-store" } });
      }
      const accessCookie = request.headers.get("cookie")?.match(/(?:^|;\s*)wf_trial=([^;]+)/)?.[1];
      if (!await verifyTrialCookie(accessCookie, env.TRIAL_CODE, Date.now())) return Response.json({ error: "trial_required" }, { status: 403 });
      actor = accessCookie!.split(".")[1]!;
    }
    const create = request.method === "POST" && url.pathname === "/api/rooms";
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const code = create ? Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % alphabet.length]).join("")
      : url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/join$/)?.[1]
        ?? request.headers.get("cookie")?.match(/(?:^|;\s*)wf_room=([A-Z0-9]{6})(?:;|$)/)?.[1];
    let gate: DurableObjectStub | undefined;
    if (trialEnabled) {
      gate = env.TRIAL_GATE!.get(env.TRIAL_GATE!.idFromName("limited-trial"));
      const action = create ? "create" : url.pathname.endsWith("/join") ? "join" : request.method === "GET" ? "refresh" : "command";
      const admission = await gate.fetch(new Request("https://gate/admit", { method: "POST", body: JSON.stringify({ action, actor, roomCode: code }) }));
      if (!admission.ok) {
        const result = await admission.json() as { reason: string; retryAfter: number };
        return Response.json({ error: result.reason }, { status: 429, headers: { "retry-after": String(result.retryAfter) } });
      }
    }
    if (!code) return Response.json(url.pathname === "/api/session" ? { snapshot: null } : { error: "session_not_found" }, { status: url.pathname === "/api/session" ? 200 : 401 });
    const internalUrl = new URL(request.url);
    internalUrl.hostname = code.toLowerCase();
    const response = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(internalUrl, request));
    if (gate && ((create && !response.ok) || (response.ok && url.pathname === "/api/command" && response.headers.get("x-wf-phase") === "ended"))) {
      await gate.fetch(new Request("https://gate/release", { method: "POST", body: JSON.stringify({ action: "release", actor, roomCode: code }) }));
    }
    if (response.status === 101) return response;
    const result = new Response(response.body, response);
    result.headers.set("cache-control", "no-store");
    result.headers.set("x-robots-tag", "noindex, nofollow");
    if (result.ok && (create || url.pathname.endsWith("/join"))) result.headers.append("set-cookie", `wf_room=${code}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7200`);
    return result;
}
