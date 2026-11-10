import { expect, test } from "@playwright/test";

test("host removes only disconnected participants through the live room connection", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const activeContext = await browser.newContext();
  const offlineContext = await browser.newContext();
  try {
    const host = await hostContext.newPage(), active = await activeContext.newPage(), offline = await offlineContext.newPage();
    await host.goto("/");
    await host.getByRole("button", { name: "ルームを作る", exact: true }).click();
    const code = (await host.locator(".room-code").innerText()).trim();
    for (const [page, name] of [[active, "接続中の人"], [offline, "切断する人"]] as const) {
      await page.goto(`/?room=${code}`);
      await page.getByLabel("ルーム内の名前").fill(name);
      await page.getByRole("button", { name: "ルームに参加", exact: true }).click();
    }
    await expect(host.getByText("2人が接続中")).toBeVisible();
    await offlineContext.close();
    await expect(host.getByText("1人が接続中")).toBeVisible();
    host.once("dialog", dialog => dialog.accept());
    await host.getByRole("button", { name: /切断中の参加者を一括除外/ }).click();
    await expect(host.locator(".participant-row")).toHaveCount(1);
    await expect(host.locator(".participant-name")).toHaveText("接続中の人");
    await expect(active.getByRole("heading", { name: "接続中の人", exact: true })).toBeVisible();
    await expect(host.getByRole("button", { name: /切断中の参加者を一括除外/ })).toBeDisabled();
    host.once("dialog", dialog => dialog.accept());
    await host.getByRole("button", { name: "ルームを終了", exact: true }).click();
    await expect(host.getByRole("heading", { name: "ルームは終了しました" })).toBeVisible();
  } finally {
    await hostContext.close(); await activeContext.close(); await offlineContext.close();
  }
});
