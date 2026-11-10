import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { WebSocket } from "ws";
import type { LocalCommand, RoomSnapshot } from "@webflipper/runtime";
import {
  createHostAnswerPlan,
  createRandomDrawing,
  dummyHelp,
  parseDummyCommand,
  selectCorrectParticipantIds,
  shouldAutoStartRound,
  type DummyRole,
  type HostAnswerMode
} from "./dummy-protocol";

const API_URL = process.env.WEBFLIPPER_API_URL ?? "http://127.0.0.1:8787";
const role = process.argv[2] as DummyRole | undefined;
const requestedMinimumParticipants = Number(process.argv[3] ?? 1);
const minimumParticipants = role === "host" && Number.isInteger(requestedMinimumParticipants)
  ? Math.min(15, Math.max(1, requestedMinimumParticipants))
  : 1;

if (role !== "host" && role !== "participant") {
  process.stdout.write("使い方:\n  pnpm dummy:host -- [自動開始人数]\n  pnpm dummy:participant -- <ルームコード> [名前]\n");
  process.exit(1);
}

type ApiResponse = { snapshot: RoomSnapshot | null; roomCode?: string };

async function post(path: string, body: unknown, cookie?: string) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
  const value = await response.json() as ApiResponse & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `http_${response.status}`);
  return { value, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? cookie ?? "" };
}

function summary(snapshot: RoomSnapshot | null) {
  if (!snapshot) return "セッションなし";
  const round = snapshot.room.round;
  return [
    `状態=${snapshot.room.phase}`,
    `参加者=${snapshot.room.participants.filter((participant) => !participant.left).length}`,
    round ? `お題=${JSON.stringify(round.prompt)} 回答=${round.answers.length}/${round.targetParticipantIds.length}` : ""
  ].filter(Boolean).join(" / ");
}

let sessionCookie = "";
let latestSnapshot: RoomSnapshot | null = null;
let currentDrawing = { operations: [] as unknown[] };
const handledAutomationStates = new Set<string>();
const answerPlan = createHostAnswerPlan(Math.random);
const prompts = [
  "空を飛ぶもの",
  "丸いもの",
  "雨の日に使うもの",
  "冷たいもの",
  "音が出るもの"
];

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function randomDelay(minimum: number, maximum: number) {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

function modeLabel(mode: HostAnswerMode) {
  if (mode === "all-correct") return "全回答正解";
  if (mode === "all-wrong") return "正解者なし";
  return "ランダム判定";
}

if (role === "host") {
  const created = await post("/api/rooms", { capacity: 10, answerSeconds: 30, scoreMode: "correct-count" });
  sessionCookie = created.cookie;
  latestSnapshot = created.value.snapshot;
  const roomCode = created.value.roomCode ?? latestSnapshot?.room.roomCode ?? "";
  process.stdout.write(
    `ダミーホストを作成しました。参加者が${minimumParticipants}名揃うと5問を自動進行します。\n` +
    `ルームコード: ${roomCode}\n参加URL: http://127.0.0.1:5173/?room=${roomCode}\n` +
    `判定計画: ${answerPlan.map((mode, index) => `${index + 1}問目=${modeLabel(mode)}`).join(" / ")}\n`
  );
} else {
  const roomCode = (process.argv[3] ?? "").trim().toUpperCase();
  const name = (process.argv[4] ?? `ダミー参加者${Math.floor(Math.random() * 9_000 + 1_000)}`).trim();
  if (!roomCode) {
    process.stderr.write("ルームコードを指定してください: pnpm dummy:participant -- K7M4PX [名前]\n");
    process.exit(1);
  }
  const joined = await post(`/api/rooms/${roomCode}/join`, { name });
  sessionCookie = joined.cookie;
  latestSnapshot = joined.value.snapshot;
  process.stdout.write(`${name} として ${roomCode} に参加しました。各ラウンドで自動描画・自動確定します。\n`);
}

async function sendCommand(command: LocalCommand) {
  const sent = await post("/api/command", command, sessionCookie);
  latestSnapshot = sent.value.snapshot;
  if (latestSnapshot) void runAutomation(latestSnapshot);
  return latestSnapshot;
}

async function runHostAutomation(snapshot: RoomSnapshot) {
  const { room } = snapshot;
  if (room.phase === "waiting" && room.completedRounds < 5) {
    const connectedParticipants = room.participants.filter((participant) => participant.connected && !participant.left);
    if (!shouldAutoStartRound(connectedParticipants.length, minimumParticipants)) return;
    const key = `host:waiting:${room.completedRounds}`;
    if (handledAutomationStates.has(key)) return;
    handledAutomationStates.add(key);
    await wait(randomDelay(700, 1_600));
    if (latestSnapshot?.room.phase !== "waiting" || latestSnapshot.room.completedRounds !== room.completedRounds) return;
    const prompt = prompts[room.completedRounds] ?? `お題 ${room.completedRounds + 1}`;
    process.stdout.write(`\n[自動] ${room.completedRounds + 1}問目を開始: ${prompt}\n> `);
    await sendCommand({
      type: "round.start",
      prompt,
      answerSeconds: 30,
      revealNamesDuringJudging: false
    });
    return;
  }

  if (room.phase === "judging" && room.round) {
    const key = `host:judging:${room.round.startedAt}`;
    if (handledAutomationStates.has(key)) return;
    handledAutomationStates.add(key);
    await wait(randomDelay(700, 1_600));
    if (latestSnapshot?.room.phase !== "judging" || latestSnapshot.room.round?.startedAt !== room.round.startedAt) return;
    const mode = answerPlan[room.completedRounds] ?? "random";
    const participantIds = room.round.answers.map((answer) => answer.participantId);
    const correctParticipantIds = selectCorrectParticipantIds(mode, participantIds, Math.random);
    process.stdout.write(`\n[自動] ${room.completedRounds + 1}問目の判定: ${modeLabel(mode)} (${correctParticipantIds.length}/${participantIds.length})\n> `);
    for (const participantId of correctParticipantIds) {
      await sendCommand({ type: "answer.toggleCorrect", participantId });
    }
    await sendCommand({ type: "results.publish" });
    return;
  }

  if (room.phase === "results") {
    const key = `host:results:${room.completedRounds}`;
    if (handledAutomationStates.has(key)) return;
    handledAutomationStates.add(key);
    await wait(randomDelay(900, 1_900));
    if (latestSnapshot?.room.phase !== "results" || latestSnapshot.room.completedRounds !== room.completedRounds) return;
    if (room.completedRounds >= 5) {
      process.stdout.write("\n[自動] 5問が終了しました。ルームを終了します。\n> ");
      await sendCommand({ type: "room.end" });
    } else {
      await sendCommand({ type: "round.next" });
    }
  }
}

async function runParticipantAutomation(snapshot: RoomSnapshot) {
  const { room, participantId } = snapshot;
  if (room.phase !== "answering" || !room.round || !participantId) return;
  if (!room.round.targetParticipantIds.includes(participantId)) return;
  const key = `participant:answering:${room.round.startedAt}`;
  if (handledAutomationStates.has(key)) return;
  handledAutomationStates.add(key);

  await wait(randomDelay(450, 1_600));
  if (latestSnapshot?.room.phase !== "answering" || latestSnapshot.room.round?.startedAt !== room.round.startedAt) return;
  currentDrawing = createRandomDrawing(Math.random);
  process.stdout.write(`\n[自動] ${currentDrawing.operations.length}本の線を描きました。\n> `);
  await sendCommand({ type: "draft.save", drawing: currentDrawing });

  await wait(randomDelay(450, 1_600));
  if (latestSnapshot?.room.phase !== "answering" || latestSnapshot.room.round?.startedAt !== room.round.startedAt) return;
  process.stdout.write("\n[自動] 回答を確定します。\n> ");
  await sendCommand({ type: "answer.confirm", drawing: currentDrawing });
}

async function runAutomation(snapshot: RoomSnapshot) {
  try {
    if (role === "host") await runHostAutomation(snapshot);
    else await runParticipantAutomation(snapshot);
  } catch (error) {
    process.stdout.write(`\n[自動処理エラー] ${error instanceof Error ? error.message : "unknown_error"}\n> `);
  }
}

const socketUrl = API_URL.replace(/^http/u, "ws");
const socket = new WebSocket(`${socketUrl}/ws`, { headers: { cookie: sessionCookie } });
socket.on("message", (data) => {
  const message = JSON.parse(String(data)) as { type: string; snapshot?: RoomSnapshot };
  if (message.type === "snapshot" && message.snapshot) {
    latestSnapshot = message.snapshot;
    process.stdout.write(`\n[更新] ${summary(latestSnapshot)}\n> `);
    void runAutomation(latestSnapshot);
  }
});
socket.on("close", () => process.stdout.write("\nリアルタイム接続が終了しました。\n"));

process.stdout.write(`${dummyHelp(role)}\n> `);
const input = createInterface({ input: stdin, output: stdout });

if (latestSnapshot) void runAutomation(latestSnapshot);

for await (const line of input) {
  const action = parseDummyCommand(role, line);
  try {
    if (action.kind === "help") process.stdout.write(`${dummyHelp(role)}\n`);
    if (action.kind === "state") process.stdout.write(`${JSON.stringify(latestSnapshot, null, 2)}\n`);
    if (action.kind === "invalid") process.stdout.write(`${action.message}\n`);
    if (action.kind === "draw") {
      currentDrawing = createRandomDrawing(Math.random);
      await sendCommand({ type: "draft.save", drawing: currentDrawing });
      process.stdout.write("サンプル描画を下書き保存しました。\n");
    }
    if (action.kind === "confirm") {
      await sendCommand({ type: "answer.confirm", drawing: currentDrawing });
      process.stdout.write("回答を確定しました。\n");
    }
    if (action.kind === "leave") {
      await post("/api/leave", {}, sessionCookie);
      process.stdout.write("ルームから退出しました。\n");
      break;
    }
    if (action.kind === "send") {
      await sendCommand(action.command satisfies LocalCommand);
      process.stdout.write(`送信しました: ${action.command.type}\n`);
    }
    if (action.kind === "quit") break;
  } catch (error) {
    process.stdout.write(`エラー: ${error instanceof Error ? error.message : "unknown_error"}\n`);
  }
  process.stdout.write("> ");
}

input.close();
socket.close();
