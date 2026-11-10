import type { LocalCommand } from "@webflipper/runtime";

export type DummyRole = "host" | "participant";

export type DummyAction =
  | { kind: "send"; command: LocalCommand }
  | { kind: "draw" }
  | { kind: "confirm" }
  | { kind: "leave" }
  | { kind: "state" }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "invalid"; message: string };

const ANSWER_SECONDS = new Set([30, 60, 90, 120, 180]);

export type HostAnswerMode = "all-correct" | "all-wrong" | "random";

export function shouldAutoStartRound(connectedParticipants: number, minimumParticipants: number) {
  return connectedParticipants >= minimumParticipants;
}

export function createHostAnswerPlan(random: () => number): HostAnswerMode[] {
  const plan: HostAnswerMode[] = Array.from({ length: 5 }, () => "random");
  const allCorrectRound = Math.floor(random() * 5);
  const remainingIndex = Math.floor(random() * 4);
  const allWrongRound = remainingIndex >= allCorrectRound ? remainingIndex + 1 : remainingIndex;
  plan[allCorrectRound] = "all-correct";
  plan[allWrongRound] = "all-wrong";
  return plan;
}

export function selectCorrectParticipantIds(
  mode: HostAnswerMode,
  participantIds: string[],
  random: () => number
) {
  if (mode === "all-correct") return [...participantIds];
  if (mode === "all-wrong") return [];
  return participantIds.filter(() => random() < 0.5);
}

export function createRandomDrawing(random: () => number) {
  const strokeCount = 2 + Math.floor(random() * 4);
  return {
    operations: Array.from({ length: strokeCount }, () => {
      const pointCount = 3 + Math.floor(random() * 5);
      return {
        kind: "stroke" as const,
        points: Array.from({ length: pointCount }, () => [
          48 + random() * 928,
          48 + random() * 672
        ] as [number, number])
      };
    })
  };
}

export function parseDummyCommand(role: DummyRole, input: string): DummyAction {
  const value = input.trim();
  if (value === "help") return { kind: "help" };
  if (value === "state") return { kind: "state" };
  if (value === "quit") return { kind: "quit" };

  if (role === "host") {
    const start = value.match(/^start\s+(\d+)\s+(.+)$/u);
    if (start) {
      const answerSeconds = Number(start[1]);
      if (!ANSWER_SECONDS.has(answerSeconds)) {
        return { kind: "invalid", message: "回答時間は30/60/90/120/180秒から選んでください。" };
      }
      return {
        kind: "send",
        command: {
          type: "round.start",
          answerSeconds,
          prompt: start[2]?.trim() ?? "",
          revealNamesDuringJudging: false
        }
      };
    }
    if (value === "close") return { kind: "send", command: { type: "round.close" } };
    if (value === "publish") return { kind: "send", command: { type: "results.publish" } };
    if (value === "next") return { kind: "send", command: { type: "round.next" } };
    if (value === "end") return { kind: "send", command: { type: "room.end" } };
    const correct = value.match(/^correct\s+(\S+)$/u);
    if (correct) {
      return { kind: "send", command: { type: "answer.toggleCorrect", participantId: correct[1] ?? "" } };
    }
    return { kind: "invalid", message: "不明なホストコマンドです。helpで一覧を表示できます。" };
  }

  if (value === "draw") return { kind: "draw" };
  if (value === "confirm") return { kind: "confirm" };
  if (value === "reopen") return { kind: "send", command: { type: "answer.reopen" } };
  if (value === "exit") return { kind: "leave" };
  return { kind: "invalid", message: "不明な参加者コマンドです。helpで一覧を表示できます。" };
}

export function dummyHelp(role: DummyRole) {
  return role === "host"
    ? [
        "自動運転: 参加者が入ると5問を開始し、判定・結果公開・終了まで進めます。",
        "start <30|60|90|120|180> <お題>  ラウンド開始",
        "close                              回答受付終了",
        "correct <参加者ID>                 正解の切替",
        "publish                            結果公開",
        "next                               次のラウンド",
        "end                                ルーム終了",
        "state / help / quit"
      ].join("\n")
    : [
        "自動運転: 各ラウンドでランダムに描画し、少し待って回答を確定します。",
        "draw       サンプルの線を下書き保存",
        "confirm    現在の描画を回答確定",
        "reopen     回答確定を取り消す",
        "exit       ルームから退出",
        "state / help / quit"
      ].join("\n");
}
