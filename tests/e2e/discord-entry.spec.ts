import { expect, test } from "@playwright/test";

test("Discord identity prefills the editable room name while anonymous entry remains available", async ({ page }) => {
  await page.route("**/api/session", route => route.fulfill({ json: { snapshot: null } }));
  await page.route("**/api/discord/profile", route => route.fulfill({ json: { configured: true, profile: { displayName: "Discordの名前", avatarUrl: null } } }));
  await page.goto("/?room=ABC234");
  await expect(page.getByLabel("ルーム内の名前")).toHaveValue("Discordの名前");
  await page.getByLabel("ルーム内の名前").fill("ゲーム内の名前");
  await expect(page.getByRole("button", { name: "匿名で参加する" })).toBeVisible();
  const appearance = await page.getByRole("button", { name: "匿名で参加する" }).evaluate(element => ({ border: parseFloat(getComputedStyle(element).borderTopWidth), height: element.getBoundingClientRect().height }));
  expect(appearance.border).toBeGreaterThan(0);
  expect(appearance.height).toBeGreaterThanOrEqual(40);
  const label = await page.getByText("Discord: Discordの名前").boundingBox();
  const anonymous = await page.getByRole("button", { name: "匿名で参加する" }).boundingBox();
  expect(Math.abs((label!.y + label!.height / 2) - (anonymous!.y + anonymous!.height / 2))).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileButton = await page.getByRole("button", { name: "匿名で参加する" }).boundingBox();
  expect(mobileButton!.x).toBeGreaterThanOrEqual(0);
  expect(mobileButton!.x + mobileButton!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole("button", { name: "ルームに参加", exact: true })).toBeEnabled();
  let received: { name: string; discord: string | undefined } | undefined;
  await page.route("**/api/rooms/ABC234/join", async route => {
    received = { name: route.request().postDataJSON().name, discord: route.request().headers()["x-wf-use-discord"] };
    await route.fulfill({ status: 400, json: { error: "room_full" } });
  });
  await page.getByRole("button", { name: "ルームに参加", exact: true }).click();
  await expect.poll(() => received).toEqual({ name: "ゲーム内の名前", discord: "1" });
});

test("offers optional Discord sign-in when no identity is linked", async ({ page }, testInfo) => {
  await page.route("**/api/session", route => route.fulfill({ json: { snapshot: null } }));
  await page.route("**/api/discord/profile", route => route.fulfill({ json: { configured: true, profile: null } }));
  await page.goto("/?room=ABC234");
  await expect(page.getByRole("link", { name: "Discordでログイン" })).toHaveAttribute("href", /\/api\/discord\/start\?next=/);
  await expect(page.getByLabel("ルーム内の名前")).toHaveValue("");
  await page.screenshot({ path: testInfo.outputPath("discord-entry.png"), fullPage: true });
});
