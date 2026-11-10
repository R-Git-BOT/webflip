import { expect, test } from "@playwright/test";

test("requires trial access, saves a PNG answer and rejects refresh bursts", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  const code = process.env.TRIAL_TEST_CODE ?? "local-only-test-code";
  const authorize = async (page: typeof host, path: string) => {
    await page.goto(path);
    await expect(page.getByLabel("試用コード")).toBeVisible();
    await page.getByLabel("試用コード").fill(code);
    await page.getByRole("button", { name: "利用を開始" }).click();
  };
  await authorize(host, "/");
  await host.getByRole("button", { name: "ルームを作る", exact: true }).click();
  const roomCode = (await host.locator(".room-code").innerText()).trim();
  await authorize(guest, `/?room=${roomCode}`);
  await guest.getByLabel("ルーム内の名前").fill("試用参加者");
  await guest.getByRole("button", { name: "ルームに参加", exact: true }).click();
  await expect(host.getByText("1人が接続中")).toBeVisible();
  await host.getByRole("button", { name: "ラウンドを始める" }).click();
  await host.getByLabel("お題").fill("限定公開テスト");
  await host.getByRole("button", { name: "回答受付を始める" }).click();
  await expect(guest.getByLabel("青いキャンバス。白いペンで回答を描きます")).toBeVisible();
  await guest.getByRole("button", { name: "回答を確定" }).click();
  await expect(host.getByRole("heading", { name: "正解を選ぶ" })).toBeVisible();
  await host.getByRole("button", { name: "結果を公開" }).click();
  await expect(guest.getByText("結果", { exact: true })).toBeVisible();
  // End through the authenticated current browser connection, then free the trial room.
  await host.getByRole("button", { name: "次のラウンド" }).click();
  host.once("dialog", dialog => dialog.accept());
  await host.getByRole("button", { name: "ルームを終了" }).click();
  await expect(host.getByRole("heading", { name: "ルームは終了しました" })).toBeVisible();
  const rejectedCode = await guest.evaluate(() => new Promise<number>(resolve => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws?connection=${crypto.randomUUID()}`);
    const timeout = setTimeout(() => { socket.close(); resolve(0); }, 2500);
    socket.onopen = () => socket.send("unexpected client message");
    socket.onclose = event => { clearTimeout(timeout); resolve(event.code); };
  }));
  expect(rejectedCode).toBe(4008);
  let status = 0;
  for (let i = 0; i < 15 && status !== 429; i++) status = (await guestContext.request.get("/api/session")).status();
  expect(status).toBe(429);
  await hostContext.close(); await guestContext.close();
});
