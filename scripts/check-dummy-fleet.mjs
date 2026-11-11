import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const tsx = pathToFileURL(resolve(root, "apps/local-server/node_modules/tsx/dist/loader.mjs")).href;
const origin = "http://127.0.0.1:8899";
const state = resolve(root, `output/dummy/check-${randomUUID()}.json`);
await mkdir(resolve(root, "output/dummy"), { recursive: true });
const server = spawn(process.execPath, ["--import", tsx, "apps/local-server/src/index.ts"], { cwd: root, env: { ...process.env, PORT: "8899" }, stdio: ["ignore", "pipe", "pipe"] });
let fleet;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(path, body, cookie = "") {
  const response = await fetch(origin + path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw Error(`${path}: ${JSON.stringify(value)}`);
  return { value, cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { await fetch(origin + "/api/session"); ready = true; break; } catch { await sleep(100); } }
  if (!ready) throw Error("local server failed to start");
  const host = await post("/api/rooms", { capacity: 50, answerSeconds: 30, scoreMode: "correct-count" });
  const room = host.value.roomCode;
  const started = performance.now();
  fleet = spawn(process.execPath, ["--import", tsx, "apps/local-server/src/dummy-fleet-cli.ts", room, "50", origin, "", state], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let online = 0, confirmed = 0, lastStatus, output = "", errors = "";
  fleet.stderr.on("data", b => { errors += b; });
  fleet.stdout.on("data", b => {
    output += b;
    let newline;
    while ((newline = output.indexOf("\n")) >= 0) {
      const line = output.slice(0, newline); output = output.slice(newline + 1);
      if (line.endsWith(": online")) online++;
      if (line.endsWith(": confirmed")) confirmed++;
      if (line.startsWith("{")) lastStatus = JSON.parse(line);
    }
  });
  for (let i = 0; i < 200 && online < 50; i++) { if (fleet.exitCode !== null) throw Error(errors); await sleep(100); }
  if (online !== 50) throw Error(`Only ${online}/50 connected: ${errors}`);
  const joinMs = Math.round(performance.now() - started);
  const snapshot = await (await fetch(origin + "/api/session", { headers: { cookie: host.cookie } })).json();
  if (snapshot.snapshot.room.participants.filter(p => p.connected && !p.left).length !== 50) throw Error("Server does not see fifty online participants");
  await post("/api/command", { type: "round.start", prompt: "50人試験", answerSeconds: 30, revealNamesDuringJudging: false, startedAt: Date.now() }, host.cookie);
  for (let i = 0; i < 200 && confirmed < 50; i++) await sleep(100);
  if (confirmed !== 50) throw Error(`Only ${confirmed}/50 confirmed`);
  const saved = JSON.parse(await readFile(state, "utf8"));
  if (saved.sessions.length !== 50) throw Error("Session persistence incomplete");
  console.log(JSON.stringify({ online, confirmed, joinMs, status: lastStatus, clientProcesses: 1, browsers: 0 }));
  await post("/api/command", { type: "room.end" }, host.cookie);
  for (let i = 0; i < 30 && fleet.exitCode === null; i++) await sleep(100);
  if (fleet.exitCode !== 0) throw Error(`Fleet did not stop cleanly: ${errors}`);
} finally {
  if (fleet?.exitCode === null) fleet.kill();
  server.kill();
  await rm(state, { force: true });
  await rm(state + ".lock", { force: true });
}
