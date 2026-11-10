import { expect, it } from "vitest";
import { issueTrialCookie, verifyTrialCookie, safeTrialPath } from "../src/trial-access";
it("accepts a signed trial cookie but rejects tampering, expiration and secret rotation", async () => {
  const cookie = await issueTrialCookie("a-long-test-secret", 1000);
  expect(await verifyTrialCookie(cookie, "a-long-test-secret", 2000)).toBe(true);
  expect(await verifyTrialCookie(cookie + "x", "a-long-test-secret", 2000)).toBe(false);
  expect(await verifyTrialCookie(cookie, "rotated-secret", 2000)).toBe(false);
  expect(await verifyTrialCookie(cookie, "a-long-test-secret", 86401000)).toBe(false);
});

it("preserves invitation paths but rejects external and backslash redirects", () => {
  expect(safeTrialPath("/?room=ABC234")).toBe("/?room=ABC234");
  expect(safeTrialPath("//evil.test")).toBe("/");
  expect(safeTrialPath("/\\evil.test")).toBe("/");
  expect(safeTrialPath("/\nevil.test")).toBe("/");
});
