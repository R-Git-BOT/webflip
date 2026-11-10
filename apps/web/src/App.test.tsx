import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App, HomeScreen, selectInitialSnapshot } from "./App";

describe("App", () => {
  it("offers room creation and room joining from the home screen", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("WebFlipper");
    expect(html).toContain("ルームを作る");
    expect(html).toContain("ルームに参加");
    expect(html).not.toContain("おして、めくって、みんなで当てる");
  });

  it("shows a participant-only entrance when opened from a room URL", () => {
    const html = renderToStaticMarkup(
      <HomeScreen
        busy={false}
        error={null}
        initialRoomCode="K7M4PX"
        joinOnly
        onCreate={() => undefined}
        onJoin={() => undefined}
      />
    );

    expect(html).toContain("このルームに参加");
    expect(html).toContain("K7M4PX");
    expect(html).not.toContain("<h2>ルームを作る</h2>");
  });

  it("does not restore a stale session when opening an invite for another room", () => {
    const staleSession = {
      role: "participant" as const,
      participantId: "old-participant",
      room: { roomCode: "OLD234", phase: "ended" }
    };

    expect(selectInitialSnapshot(staleSession, "UG93V7")).toBeNull();
  });
});
