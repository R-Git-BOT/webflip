import { expect, test } from "@playwright/test";

test("host and participant complete one drawing round", async ({ browser }, testInfo) => {
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const participantContext = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const host = await hostContext.newPage();
  const participant = await participantContext.newPage();
  const consoleErrors: string[] = [];
  host.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  participant.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await host.goto("/");
  await expect(host).toHaveTitle("WebFlipper");
  await expect(host.getByRole("heading", { name: "手書きクイズ" })).toBeVisible();
  await expect(host.getByLabel("定員").locator("option")).toHaveText(["10人", "15人", "20人", "25人", "30人", "35人", "40人", "45人", "50人"]);
  await expect(host.getByLabel("定員")).toHaveValue("10");
  await host.getByLabel("定員").selectOption("50");
  await host.getByRole("button", { name: "ルームを作る", exact: true }).click();
  await expect(host.locator(".participant-count")).toHaveText("0 / 50");
  const roomCode = (await host.locator(".room-code").innerText()).trim();
  await expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

  await participant.goto(`/?room=${roomCode}`);
  await expect(participant.getByRole("heading", { name: "このルームに参加" })).toBeVisible();
  await expect(participant.getByRole("button", { name: "ルームを作る", exact: true })).toHaveCount(0);
  await participant.screenshot({ path: testInfo.outputPath("invite-entrance.png"), fullPage: true });
  await participant.getByLabel("ルーム内の名前").fill("たろう");
  await participant.getByRole("button", { name: "ルームに参加", exact: true }).click();
  await expect(host.getByText("1人が接続中")).toBeVisible();
  await host.screenshot({ path: testInfo.outputPath("host-waiting.png"), fullPage: true });
  await participant.screenshot({ path: testInfo.outputPath("participant-waiting-with-exit.png"), fullPage: true });

  await hostContext.setOffline(true);
  participant.once("dialog", (dialog) => dialog.accept());
  await participant.getByRole("button", { name: "ルームを退出" }).click();
  await expect(participant.getByRole("heading", { name: "このルームに参加" })).toBeVisible();
  await expect(participant.getByText("ルームから退出しました")).toBeVisible();
  await hostContext.setOffline(false);
  await expect(host.getByText("0人が接続中")).toBeVisible();
  await participant.screenshot({ path: testInfo.outputPath("after-exit.png"), fullPage: true });

  await participant.getByLabel("ルーム内の名前").fill("たろう");
  await participant.getByRole("button", { name: "ルームに参加", exact: true }).click();
  await expect(host.getByText("1人が接続中")).toBeVisible();

  await host.getByRole("button", { name: "ラウンドを始める" }).click();
  await host.getByLabel("お題").fill("空を飛ぶもの");
  await host.getByRole("button", { name: "回答受付を始める" }).click();

  const canvas = participant.getByLabel("青いキャンバス。白いペンで回答を描きます");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas_not_visible");
  await participant.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await participant.mouse.down();
  await participant.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2, { steps: 8 });
  await participant.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 8 });
  await participant.mouse.up();
  const draftSaved = participant.waitForResponse(response => {
    if (!response.url().endsWith("/api/command") || response.request().method() !== "POST") return false;
    const command = response.request().postDataJSON();
    return command.type === "draft.save" && command.drawing.redoOperations?.length === 1 && response.ok();
  });
  await participant.getByRole("button", { name: "元に戻す", exact: true }).click();
  await draftSaved;
  await participant.reload();
  await expect(participant.getByRole("button", { name: "やり直す", exact: true })).toBeEnabled();
  await participant.getByRole("button", { name: "やり直す", exact: true }).click();
  await participant.screenshot({ path: testInfo.outputPath("participant-drawing.png"), fullPage: true });
  await participant.getByRole("button", { name: "回答を確定" }).click();

  await expect(host.getByRole("heading", { name: "正解を選ぶ" })).toBeVisible();
  await host.getByRole("button", { name: /回答 1/ }).click();
  let rejectedOldRound = false;
  await host.route("**/api/command", async route => {
    if (!rejectedOldRound && route.request().postDataJSON().type === "results.publish") {
      rejectedOldRound = true;
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "stale_round" }) });
    } else await route.continue();
  });
  await host.getByRole("button", { name: "結果を公開" }).click();
  await expect(host.getByRole("alert")).toContainText("最新のラウンド情報へ更新しました");
  await expect(host.getByRole("heading", { name: "正解を選ぶ" })).toBeVisible();
  await host.getByRole("button", { name: "結果を公開" }).click();
  await expect(participant.getByText("結果", { exact: true })).toBeVisible();
  await expect(participant.locator(".answer-card--correct")).toHaveCount(1);
  await host.screenshot({ path: testInfo.outputPath("host-results.png"), fullPage: true });

  await host.getByRole("button", { name: "次の問題へ", exact: true }).click();
  await host.getByLabel("お題", { exact: true }).fill("次のお題");
  await host.getByRole("button", { name: "回答受付を始める" }).click();
  await expect(participant.getByRole("heading", { name: "次のお題" })).toBeVisible();
  await participant.setViewportSize({ width: 390, height: 664 });
  const mobileCanvas = participant.locator(".canvas-frame canvas");
  const rect = await mobileCanvas.boundingBox();
  expect(rect).not.toBeNull();
  expect(Math.abs((rect!.width - 6) / (rect!.height - 6) - 4 / 3)).toBeLessThan(0.02);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(664);
  await participant.screenshot({ path: testInfo.outputPath("mobile-drawing-4by3.png") });
  await host.screenshot({ path: testInfo.outputPath("host-live-roster.png") });
  await expect(host.getByRole("complementary", { name: "参加者の接続状況" })).toContainText("たろう");
  await participant.close();
  await expect(host.getByRole("complementary")).toContainText("切断中");
  host.once("dialog", d => d.accept());
  await host.getByRole("complementary").getByRole("button", { name: "除外", exact: true }).click();
  await expect(host.getByRole("heading", { name: "参加者", exact: true })).toBeVisible();
  expect(consoleErrors.filter(message => !message.includes("400 (Bad Request)"))).toEqual([]);
  await hostContext.close();
  await participantContext.close();
});

test("home remains usable on a mobile viewport", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "手書きクイズ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ルームを作る", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-home.png"), fullPage: true });
  await context.close();
});
