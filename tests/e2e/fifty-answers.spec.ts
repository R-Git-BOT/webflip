import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
  test(`displays fifty answers within the viewport at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const participants = Array.from({ length: 50 }, (_, index) => ({ id: `p${index}`, name: `参加者${index + 1}`, connected: true, correctCount: 0 }));
    await page.route("**/api/session", route => route.fulfill({ json: { snapshot: {
      role: "host", room: {
        roomId: "r", roomCode: "ABC234", hostId: "h", phase: "results",
        settings: { capacity: 50, answerSeconds: 60, scoreMode: "none" }, completedRounds: 1, participants,
        round: {
          prompt: "50人の回答", answerSeconds: 60, startedAt: 1, endsAt: 61,
          targetParticipantIds: participants.map(p => p.id), revealNamesDuringJudging: true, locked: true,
          correctParticipantIds: ["p0"], answers: participants.map(p => ({ participantId: p.id, confirmed: true,
            drawing: { operations: [{ kind: "stroke", points: [[100, 500], [500, 100], [900, 500]] }] }
          }))
        }
      }
    } } }));
    await page.routeWebSocket("**/ws?*", () => { /* Fake connection: the supplied snapshot stays current. */ });
    await page.goto("/");
    await expect(page).toHaveTitle("WebFlipper");
    await expect(page.getByRole("heading", { name: "50人の回答" })).toBeVisible();
    await expect(page.locator(".answer-card")).toHaveCount(50);
    await expect(page.locator(".answer-card--correct")).toHaveCount(1);
    const layout = await page.locator(".answer-card").evaluateAll(cards => ({
      fits: cards.every(card => { const box = card.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth; }),
      canvasesVisible: cards.every(card => {
        const canvas = card.querySelector("canvas")!.getBoundingClientRect();
        return canvas.height > 10 && Math.abs(canvas.width / canvas.height - 4 / 3) < 0.02;
      }),
      pageFits: document.documentElement.scrollHeight <= innerHeight + 1
    }));
    expect(layout).toEqual({ fits: true, canvasesVisible: true, pageFits: true });
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("fifty-answers.png") });
  });
}
