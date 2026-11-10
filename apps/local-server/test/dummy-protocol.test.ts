import { describe, expect, it } from "vitest";
import {
  createHostAnswerPlan,
  createRandomDrawing,
  parseDummyCommand,
  selectCorrectParticipantIds,
  shouldAutoStartRound
} from "../src/dummy-protocol";

describe("dummy client command protocol", () => {
  it("parses a host round-start command", () => {
    expect(parseDummyCommand("host", "start 90 空を飛ぶもの")).toEqual({
      kind: "send",
      command: {
        type: "round.start",
        prompt: "空を飛ぶもの",
        answerSeconds: 90,
        revealNamesDuringJudging: false
      }
    });
  });

  it("parses participant drawing and lifecycle commands", () => {
    expect(parseDummyCommand("participant", "draw")).toMatchObject({ kind: "draw" });
    expect(parseDummyCommand("participant", "confirm")).toEqual({ kind: "confirm" });
    expect(parseDummyCommand("participant", "exit")).toEqual({ kind: "leave" });
  });

  it("plans five rounds with one all-correct and one all-wrong round", () => {
    expect(createHostAnswerPlan(() => 0)).toEqual([
      "all-correct",
      "all-wrong",
      "random",
      "random",
      "random"
    ]);
  });

  it("waits for the configured number of connected participants before auto-starting", () => {
    expect(shouldAutoStartRound(4, 5)).toBe(false);
    expect(shouldAutoStartRound(5, 5)).toBe(true);
  });

  it("selects answers according to the planned judgement mode", () => {
    const participantIds = ["p1", "p2", "p3"];

    expect(selectCorrectParticipantIds("all-correct", participantIds, () => 0.9)).toEqual(participantIds);
    expect(selectCorrectParticipantIds("all-wrong", participantIds, () => 0)).toEqual([]);
    expect(selectCorrectParticipantIds("random", participantIds, (() => {
      const values = [0.2, 0.8, 0.3];
      return () => values.shift() ?? 1;
    })())).toEqual(["p1", "p3"]);
  });

  it("creates a non-empty drawing inside the logical canvas", () => {
    const drawing = createRandomDrawing(() => 0.25);

    expect(drawing.operations.length).toBeGreaterThanOrEqual(2);
    expect(drawing.operations.length).toBeLessThanOrEqual(5);
    for (const operation of drawing.operations) {
      expect(operation.kind).toBe("stroke");
      expect(operation.points.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of operation.points) {
        expect(x).toBeGreaterThanOrEqual(48);
        expect(x).toBeLessThanOrEqual(976);
        expect(y).toBeGreaterThanOrEqual(48);
        expect(y).toBeLessThanOrEqual(720);
      }
    }
  });
});
