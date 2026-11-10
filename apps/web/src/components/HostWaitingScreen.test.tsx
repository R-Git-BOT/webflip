import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HostWaitingScreen } from "./HostWaitingScreen";

describe("HostWaitingScreen", () => {
  it("shows the room code, participants, settings, and start action", () => {
    const html = renderToStaticMarkup(
      <HostWaitingScreen
        roomCode="K7M4PX"
        participants={[
          { id: "p1", name: "さくらもち", connected: true, correctCount: 0 },
          { id: "p2", name: "たろう", connected: true, correctCount: 0 },
          { id: "p3", name: "ゆかぴ", connected: true, correctCount: 0 },
          { id: "p4", name: "けんちゃん", connected: true, correctCount: 0 }
        ]}
        capacity={10}
        answerSeconds={60}
        scoreMode="correct-count"
        onStart={() => undefined}
        onEnd={() => undefined}
      />
    );
    const text = html.replace(/<[^>]+>/g, "");

    expect(text).toContain("K7M4PX");
    expect(text).toContain("4 / 10");
    expect(text).toContain("さくらもち");
    expect(text).toContain("回答時間");
    expect(text).toContain("60秒");
    expect(text).toContain("ラウンドを始める");
  });
});
