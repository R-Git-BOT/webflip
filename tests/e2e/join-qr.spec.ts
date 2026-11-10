import { expect, test } from "@playwright/test";
import jsQR from "jsqr";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`opens and dismisses the enlarged invitation QR at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/session", route => route.fulfill({ json: { snapshot: { role: "host", room: {
      roomId: "r", roomCode: "QR2345", hostId: "h", phase: "waiting",
      settings: { capacity: 10, answerSeconds: 60, scoreMode: "none" }, completedRounds: 0, participants: [], round: null
    } } } }));
    await page.routeWebSocket("**/ws?*", () => {});
    await page.goto("/");
    const expand = page.getByRole("button", { name: "参加用QRコードを拡大" });
    await expect(expand).toBeVisible();
    const url = page.getByLabel("参加URL", { exact: true });
    const qrBox = await expand.boundingBox(), urlBox = await url.boundingBox();
    expect(qrBox!.y).toBeGreaterThan(urlBox!.y + urlBox!.height);
    await page.screenshot({ path: testInfo.outputPath("qr-waiting.png"), fullPage: true });
    await expand.click();
    const modal = page.getByRole("dialog", { name: "参加用QRコード" });
    await expect(modal).toBeVisible();
    const code = modal.getByRole("img", { name: "参加URLのQRコード" });
    const large = await code.boundingBox();
    expect(large!.width).toBeGreaterThan(qrBox!.width);
    expect(large!.x).toBeGreaterThanOrEqual(0);
    expect(large!.x + large!.width).toBeLessThanOrEqual(viewport.width);
    for (const svg of [expand.locator("svg"), code]) {
      const pixels = await svg.evaluate(async element => {
        const source = new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml" });
        const address = URL.createObjectURL(source);
        try {
          const image = new Image(); image.src = address; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = 432; canvas.height = 432;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0, 432, 432);
          return Array.from(context.getImageData(0, 0, 432, 432).data);
        } finally { URL.revokeObjectURL(address); }
      });
      const decoded = jsQR(new Uint8ClampedArray(pixels), 432, 432);
      expect(decoded?.data).toBe(await url.innerText());
    }
    await page.screenshot({ path: testInfo.outputPath("qr-modal.png") });
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
    await expect(expand).toBeFocused();
    await expand.click();
    await modal.getByRole("button", { name: "閉じる" }).click();
    await expect(modal).not.toBeVisible();
    await expand.click();
    await page.mouse.click(2, 2);
    await expect(modal).not.toBeVisible();
  });
}
