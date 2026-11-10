import { expect, test } from "@playwright/test";

test("host can return from an ended room and immediately create another room after reload", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage(), guest = await guestContext.newPage();
    await host.goto("/");
    await host.getByRole("button", { name: "ルームを作る", exact: true }).click();
    const oldCode = (await host.locator(".room-code").innerText()).trim();
    await guest.goto(`/?room=${oldCode}`);
    await guest.getByLabel("ルーム内の名前").fill("参加者");
    await guest.getByRole("button", { name: "ルームに参加", exact: true }).click();
    await expect(host.getByText("1人が接続中")).toBeVisible();
    host.once("dialog", dialog => dialog.accept());
    await host.getByRole("button", { name: "ルームを終了", exact: true }).click();
    await expect(host.getByRole("heading", { name: "ルームは終了しました" })).toBeVisible();
    await host.reload();
    await expect(host.getByRole("heading", { name: "ルームは終了しました" })).toBeVisible();
    const restart = host.getByRole("button", { name: "新しいルームを作る", exact: true });
    await expect(restart).toBeVisible();
    await restart.click();
    await expect(host.getByRole("heading", { name: "手書きクイズ" })).toBeVisible();
    await host.reload();
    await expect(host.getByRole("heading", { name: "手書きクイズ" })).toBeVisible();
    await host.getByRole("button", { name: "ルームを作る", exact: true }).click();
    await expect(host.locator(".room-code")).toBeVisible();
    expect((await host.locator(".room-code").innerText()).trim()).not.toBe(oldCode);
    await expect(guest.getByRole("heading", { name: "ルームは終了しました" })).toBeVisible();
    await guest.getByRole("button", { name: "トップへ戻る", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "手書きクイズ" })).toBeVisible();
    await expect(guest).toHaveURL(/\/$/);
    host.once("dialog", dialog => dialog.accept());
    await host.getByRole("button", { name: "ルームを終了", exact: true }).click();
    await expect(host.getByRole("heading", { name: "ルームは終了しました" })).toBeVisible();
  } finally { await hostContext.close(); await guestContext.close(); }
});
