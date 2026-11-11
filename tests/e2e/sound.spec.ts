import { expect, test } from "@playwright/test";

test("sound can be enabled and disabled during a room", async ({ page }) => {
  await page.route("**/api/session", route => route.fulfill({ json: { snapshot: { role: "host", room: {
    roomId: "r", roomCode: "ABC234", hostId: "h", phase: "waiting", settings: { capacity: 10, answerSeconds: 60, scoreMode: "none" }, completedRounds: 0, participants: [], round: null
  } } } }));
  await page.routeWebSocket("**/ws?*", () => {});
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "音をオフにする" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("button", { name: "音をオンにする" })).toBeVisible();
  await page.getByRole("button", { name: "音をオンにする" }).click();
  await expect(toggle).toBeVisible();
});
