import { readFile, writeFile, rename, open, unlink, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { createDummyFleet, type FleetSession } from "./dummy-fleet";
import { createFleetDrawing } from "./dummy-drawing";
import { issueFleetToken } from "./dummy-token";
import type { RoomSnapshot } from "@webflipper/runtime";

// Usage: pnpm dummy:fleet ROOM COUNT [ORIGIN] [SECRETS_JSON] [SESSIONS_JSON]
const [room, countText = "25", originText = "http://127.0.0.1:8787", secretFile, sessionFile] = process.argv.slice(2);
if (!room || !/^[A-Z0-9]{6}$/.test(room)) throw Error("Specify a six-character room code");
const count = Number(countText);
if (!Number.isInteger(count) || count < 1 || count > 50) throw Error("Count must be 1–50");
const origin = new URL(originText).origin;
if (!origin.startsWith("https:") && !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw Error("HTTPS required");
const secrets = secretFile ? JSON.parse(await readFile(resolve(secretFile), "utf8")) as { DUMMY_ACCESS_SECRET?: string } : {};
if (origin.startsWith("https:") && !secrets.DUMMY_ACCESS_SECRET) throw Error("Remote fleet requires a dedicated DUMMY_ACCESS_SECRET file");
const stateFile = resolve(sessionFile ?? `output/dummy/${new URL(origin).hostname}-${room}.json`);
await mkdir(dirname(stateFile), { recursive: true });
const lockFile = stateFile + ".lock";
try { await (await open(lockFile, "wx")).close(); }
catch { throw Error(`A fleet already owns this session file; inspect its PID before removing ${lockFile}`); }
await writeFile(lockFile, String(process.pid));
let restored: FleetSession[] = [];
try {
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  if (state.origin !== origin || state.room !== room) throw Error("Saved sessions belong to another room or origin");
  restored = state.sessions;
} catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") { await unlink(lockFile); throw e; } }
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const drawingPool = Array.from({ length: 8 }, createFleetDrawing);
const tokenHeaders = async (): Promise<Record<string, string>> => secrets.DUMMY_ACCESS_SECRET
  ? { "x-wf-dummy-token": issueFleetToken(secrets.DUMMY_ACCESS_SECRET, room, Date.now()) } : {};
async function request(path: string, cookie: string, body?: unknown, connection?: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: {
      ...await tokenHeaders(), cookie, ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(connection ? { "x-wf-connection": connection } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.status !== 429) return response;
    await delay(Math.max(1, Number(response.headers.get("retry-after")) || 60) * 1000 + 500);
  }
  throw Error("rate_limited");
}
let stopping = false;
const live = new Map<string, { cookie: string; connection: string; socket: WebSocket }>();
const fleet = createDummyFleet({
  async join(name) {
    const response = await request(`/api/rooms/${room}/join`, "", { name });
    if (!response.ok) throw Error(`join_${response.status}`);
    return { name, cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
  },
  async save(sessions) {
    await writeFile(stateFile + ".tmp", JSON.stringify({ origin, room, sessions }), { mode: 0o600 });
    await rename(stateFile + ".tmp", stateFile);
  },
  async connect(session, disconnected) {
    const connection = randomUUID();
    const socket = new WebSocket(`${origin.replace(/^http/, "ws")}/ws?connection=${connection}`, { headers: { ...await tokenHeaders(), cookie: session.cookie }, perMessageDeflate: false });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeRound: number | undefined;
    let submittedRound: number | undefined;
    let paused = false;
    let target = false;
    let opened = false;
    const drawing = drawingPool[(Number(session.name.replace(/\D/g, "")) || 0) % drawingPool.length]!;
    const schedule = () => {
      if (timer || !target || paused || stopping || !activeRound || submittedRound === activeRound) return;
      const round = activeRound;
      timer = setTimeout(async () => {
        timer = undefined;
        if (stopping || paused || activeRound !== round || !target || socket.readyState !== WebSocket.OPEN) return;
        try {
          const response = await request("/api/command", session.cookie, { type: "answer.confirm", drawing, commandId: randomUUID(), roundToken: round }, connection);
          if (response.ok) { submittedRound = round; console.log(`${session.name}: confirmed`); }
          else console.log(`${session.name}: answer HTTP ${response.status}`);
        } catch { console.log(`${session.name}: answer transport error`); }
      }, 1500 + Math.random() * 12000);
    };
    socket.on("message", raw => {
      try {
        const message = JSON.parse(String(raw)) as { type: string; snapshot?: RoomSnapshot };
        const snapshot = message.snapshot;
        if (!snapshot) return;
        // Retain no snapshots, rosters, or other participants' images.
        if (snapshot.room.phase === "ended") { void shutdown(false); return; }
        activeRound = snapshot.room.phase === "answering" ? snapshot.room.round?.startedAt : undefined;
        paused = snapshot.room.hostDisconnectedAt !== undefined || snapshot.room.storagePausedAt !== undefined;
        target = !!snapshot.participantId && !!snapshot.room.round?.targetParticipantIds.includes(snapshot.participantId);
        schedule();
      } catch { console.log(`${session.name}: invalid server message`); }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (timer) clearTimeout(timer);
      if (live.get(session.name)?.connection === connection) live.delete(session.name);
      if (opened && !stopping) disconnected();
    });
    await new Promise<void>((resolveOpen, reject) => {
      const timeout = setTimeout(() => { socket.terminate(); reject(Error("connect_timeout")); }, 15000);
      socket.once("open", () => { clearTimeout(timeout); opened = true; resolveOpen(); });
      socket.once("error", () => { clearTimeout(timeout); reject(Error("connect_failed")); });
      socket.once("close", () => { clearTimeout(timeout); if (!opened) reject(Error("connect_closed")); });
    });
    live.set(session.name, { cookie: session.cookie, connection, socket });
    console.log(`${session.name}: online`);
    return { close() { if (timer) clearTimeout(timer); socket.close(); } };
  }
}, { count, restored, intervalMs: secrets.DUMMY_ACCESS_SECRET ? 150 : 0 });
const report = setInterval(() => console.log(JSON.stringify({ ...fleet.status(), rssMiB: Math.round(process.memoryUsage().rss / 1048576) })), 10000);
async function shutdown(leave: boolean) {
  if (stopping) return;
  stopping = true;
  clearInterval(report);
  if (leave) for (const client of live.values()) {
    try { await request("/api/leave", client.cookie, {}, client.connection); } catch {}
  }
  await fleet.stop();
  await unlink(lockFile).catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => { void shutdown(true); });
process.on("SIGTERM", () => { void shutdown(true); });
await fleet.start();
console.log(JSON.stringify({ ...fleet.status(), rssMiB: Math.round(process.memoryUsage().rss / 1048576) }));
