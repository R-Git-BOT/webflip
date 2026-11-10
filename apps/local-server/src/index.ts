import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createLocalRoomService, type LocalCommand } from "@webflipper/runtime";
import { WebSocket, WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 8787);
const ROOM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SESSION_COOKIE = "wf_session";

function nextRoomCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return code;
}

const roomService = createLocalRoomService({
  nextId: randomUUID,
  nextRoomCode
});
const sockets = new Map<string, WebSocket>();

function parseCookies(request: IncomingMessage) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      })
  );
}

function sessionIdOf(request: IncomingMessage) {
  return parseCookies(request)[SESSION_COOKIE];
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function setSessionCookie(response: ServerResponse, sessionId: string) {
  response.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200`
  );
}

function clearSessionCookie(response: ServerResponse) {
  response.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

function broadcastSnapshots() {
  for (const [sessionId, socket] of sockets) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    try {
      socket.send(JSON.stringify({ type: "snapshot", snapshot: roomService.getSnapshot(sessionId) }));
    } catch {
      socket.close();
      sockets.delete(sessionId);
    }
  }
}

const deadlineTimer = setInterval(() => {
  if (roomService.expireDueRounds(Date.now()).length > 0) broadcastSnapshots();
}, 250);
deadlineTimer.unref();

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, runtime: "local-fake" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(request);
      const created = roomService.createRoom({
        capacity: Number(body.capacity ?? 10),
        answerSeconds: Number(body.answerSeconds ?? 60),
        scoreMode: body.scoreMode === "correct-count" ? "correct-count" : "none"
      });
      setSessionCookie(response, created.sessionId);
      sendJson(response, 201, {
        roomCode: created.roomCode,
        snapshot: roomService.getSnapshot(created.sessionId)
      });
      return;
    }

    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/join$/);
    if (request.method === "POST" && joinMatch) {
      const body = await readJson(request);
      const joined = roomService.joinRoom({
        roomCode: joinMatch[1] ?? "",
        name: String(body.name ?? "").trim(),
        ...(sessionIdOf(request) ? { previousSessionId: sessionIdOf(request)! } : {})
      });
      setSessionCookie(response, joined.sessionId);
      const snapshot = roomService.getSnapshot(joined.sessionId);
      sendJson(response, 200, { snapshot });
      broadcastSnapshots();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/session") {
      const sessionId = sessionIdOf(request);
      if (!sessionId) {
        sendJson(response, 200, { snapshot: null });
        return;
      }
      try {
        sendJson(response, 200, { snapshot: roomService.getSnapshot(sessionId) });
      } catch (error) {
        if (error instanceof Error && (error.message === "session_not_found" || error.message === "room_not_found")) {
          clearSessionCookie(response);
          sendJson(response, 200, { snapshot: null });
          return;
        }
        throw error;
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/leave") {
      const sessionId = sessionIdOf(request);
      if (!sessionId) {
        sendJson(response, 401, { error: "session_not_found" });
        return;
      }
      roomService.leaveRoom(sessionId);
      clearSessionCookie(response);
      sendJson(response, 200, { snapshot: null });
      broadcastSnapshots();
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/command") {
      const sessionId = sessionIdOf(request);
      if (!sessionId) {
        sendJson(response, 401, { error: "session_not_found" });
        return;
      }
      const command = (await readJson(request)) as LocalCommand;
      roomService.dispatch(sessionId, command);
      const snapshot = roomService.getSnapshot(sessionId);
      sendJson(response, 200, { snapshot });
      broadcastSnapshots();
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    sendJson(response, message.endsWith("_not_found") ? 404 : 400, { error: message });
  }
});

const webSockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const sessionId = sessionIdOf(request);
  if (!sessionId) {
    socket.destroy();
    return;
  }
  let initialSnapshot;
  try {
    initialSnapshot = roomService.getSnapshot(sessionId);
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    const previous = sockets.get(sessionId);
    previous?.close(4001, "replaced_by_new_connection");
    sockets.set(sessionId, webSocket);
    webSocket.on("close", () => {
      if (sockets.get(sessionId) !== webSocket) return;
      sockets.delete(sessionId);
      try { roomService.setConnection(sessionId, false, Date.now()); } catch { /* A removed participant has no session. */ }
      broadcastSnapshots();
    });
    try {
      roomService.setConnection(sessionId, true, Date.now());
      initialSnapshot = roomService.getSnapshot(sessionId);
    } catch {
      webSocket.close(4001, "session_expired");
      return;
    }
    webSocket.send(JSON.stringify({ type: "snapshot", snapshot: initialSnapshot }));
    broadcastSnapshots();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`WebFlipper local fake server: http://127.0.0.1:${PORT}\n`);
});
