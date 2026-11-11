import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`keeps invitations in place while scrolling fifty participants at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/session", route => route.fulfill({ json: { snapshot: { role: "host", room: {
      roomId: "r", roomCode: "QR2345", hostId: "h", phase: "waiting",
      settings: { capacity: 50, answerSeconds: 60, scoreMode: "none" }, completedRounds: 0,
      participants: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `参加者${i + 1}`, connected: i % 2 === 0, correctCount: 0 })), round: null
    } } } }));
    await page.routeWebSocket("**/ws?*", () => {});
    let submitted = "";
    await page.route("**/api/command", async route => {
      const type = route.request().postDataJSON().type;
      if (type !== "host.activity") submitted = type;
      await route.fulfill({ json: { error: "test_response" }, status: 400 });
    });
    await page.goto("/");
    await expect(page.locator(".participant-row")).toHaveCount(50);
    const panel = page.locator(".room-hero");
    const before = await panel.boundingBox();
    if (viewport.width > 1024) {
      const qr = await panel.getByRole("button", { name: "参加用QRコードを拡大" }).boundingBox();
      expect(qr!.y + qr!.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.locator(".participant-list").evaluate(element => { element.scrollTop = element.scrollHeight; });
    const after = await panel.boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
    const scroll = await page.locator(".participant-list").evaluate(element => ({ top: element.scrollTop, clipped: element.clientHeight < element.scrollHeight }));
    expect(scroll.top).toBeGreaterThan(0);
    expect(scroll.clipped).toBe(true);
    if (viewport.width > 1024) {
      await page.evaluate(() => window.scrollTo(0, 300));
      const fixed = await panel.boundingBox();
      expect(Math.abs(fixed!.y - before!.y)).toBeLessThan(2);
    }
    await page.screenshot({ path: testInfo.outputPath("waiting-scroll.png") });
    const remove = page.getByRole("button", { name: /切断中の参加者を一括除外/ });
    await expect(remove).toBeVisible();
    page.once("dialog", dialog => dialog.dismiss());
    await remove.click();
    expect(submitted).toBe("");
    page.once("dialog", dialog => dialog.accept());
    await remove.click();
    await expect.poll(() => submitted).toBe("participants.removeDisconnected");
  });
}
