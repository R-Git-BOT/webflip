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
  await host.getByRole("button", { name: "ルームを作る", exact: true }).click();
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
  await participant.screenshot({ path: testInfo.outputPath("participant-drawing.png"), fullPage: true });
  await participant.getByRole("button", { name: "回答を確定" }).click();

  await expect(host.getByRole("heading", { name: "正解を選ぶ" })).toBeVisible();
  await host.getByRole("button", { name: /回答 1/ }).click();
  await host.getByRole("button", { name: "結果を公開" }).click();
  await expect(participant.getByText("結果", { exact: true })).toBeVisible();
  await expect(participant.locator(".answer-card--correct")).toHaveCount(1);
  await host.screenshot({ path: testInfo.outputPath("host-results.png"), fullPage: true });

  expect(consoleErrors).toEqual([]);
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
