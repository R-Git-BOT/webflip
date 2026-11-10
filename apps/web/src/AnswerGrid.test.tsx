import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomState } from "@webflipper/domain";
import { AnswerGrid, getAnswerGridDimensions } from "./App";

const room: RoomState = {
  roomId: "room-1",
  roomCode: "Q7K4PX",
  hostId: "host-1",
  phase: "results",
  settings: { capacity: 10, answerSeconds: 60, scoreMode: "correct-count" },
  completedRounds: 1,
  participants: [
    { id: "p1", name: "さくら", connected: true, correctCount: 1 },
    { id: "p2", name: "そら", connected: true, correctCount: 0 }
  ],
  round: {
    prompt: "空を飛ぶもの",
    answerSeconds: 60,
    startedAt: 1,
    endsAt: 61,
    targetParticipantIds: ["p1", "p2"],
    revealNamesDuringJudging: false,
    answers: [
      { participantId: "p1", confirmed: true, drawing: { operations: [] } },
      { participantId: "p2", confirmed: true, drawing: { operations: [] } }
    ],
    locked: true,
    correctParticipantIds: ["p1"]
  }
};

describe("AnswerGrid", () => {
  it("renders correct answers in red and incorrect answers in blue with accessible result text", () => {
    const html = renderToStaticMarkup(<AnswerGrid room={room} judging={false} />);

    expect(html).toContain("answer-card--correct");
    expect(html).toContain("answer-card--incorrect");
    expect(html).toContain('aria-label="さくらの回答、正解"');
    expect(html).toContain('aria-label="そらの回答、不正解"');
    expect(html).toContain('aria-label="赤いフリップ上の手書き回答"');
    expect(html).toContain('aria-label="青いフリップ上の手書き回答"');
  });

  it("renders participant names in a dedicated strip outside the drawing surface", () => {
    const html = renderToStaticMarkup(<AnswerGrid room={room} judging={false} />);

    expect(html).toContain('<span class="answer-card__name">さくら</span>');
    expect(html).toContain('<span class="answer-card__name">そら</span>');
    expect(html).toContain('<div class="answer-card__surface"><canvas');
  });

  it("uses a compact grid that fits up to fifteen answers", () => {
    expect(getAnswerGridDimensions(1)).toEqual({ columns: 1, rows: 1 });
    expect(getAnswerGridDimensions(6)).toEqual({ columns: 3, rows: 2 });
    expect(getAnswerGridDimensions(15)).toEqual({ columns: 5, rows: 3 });
  });
  it("keeps fifty answers within five rows on desktop", () => {
    expect(getAnswerGridDimensions(50)).toEqual({ columns: 10, rows: 5 });
  });
});
