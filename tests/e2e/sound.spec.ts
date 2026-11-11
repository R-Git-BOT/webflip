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

test("copying the room code and invitation plays the copy sound", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const played: number[] = [];
    (window as unknown as { soundsPlayed: number[] }).soundsPlayed = played;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { played.push(this.buffer?.duration ?? 0); return start.apply(this, args); };
  });
  await page.route("**/api/session", route => route.fulfill({ json: { snapshot: { role: "host", room: {
    roomId: "r", roomCode: "ABC234", hostId: "h", phase: "waiting", settings: { capacity: 10, answerSeconds: 60, scoreMode: "none" }, completedRounds: 0, participants: [], round: null
  } } } }));
  await page.routeWebSocket("**/ws?*", () => {});
  await page.goto("/");
  await page.getByRole("button", { name: "コードをコピー" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("ABC234");
  await expect.poll(() => page.evaluate(() => (window as unknown as { soundsPlayed: number[] }).soundsPlayed.length)).toBe(1);
  await page.getByRole("button", { name: "参加リンクをコピー" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("/?room=ABC234");
  await expect.poll(() => page.evaluate(() => (window as unknown as { soundsPlayed: number[] }).soundsPlayed.length)).toBe(2);
  const sounds = await page.evaluate(() => (window as unknown as { soundsPlayed: number[] }).soundsPlayed);
  expect(sounds[0]).toBeGreaterThan(0);
  expect(sounds[1]).toBe(sounds[0]);
  await page.getByRole("button", { name: "音をオフにする" }).click();
  await page.getByRole("button", { name: "コードをコピー" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("ABC234");
  expect(await page.evaluate(() => (window as unknown as { soundsPlayed: number[] }).soundsPlayed.length)).toBe(2);
});
