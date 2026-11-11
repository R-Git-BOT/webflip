import { expect, it } from "vitest";
import { issueDummyToken, verifyDummyToken } from "../src/dummy-access";
import { issueFleetToken } from "../../local-server/src/dummy-token";

it("accepts the Node fleet issuer's wire format", async () => {
  expect(await verifyDummyToken(issueFleetToken("test-secret", "ABC234", 1000), "test-secret", "ABC234", 2000)).toBe(true);
});

it("allows a signed dummy only in its room and lifetime, and rejects tampering and rotation", async () => {
  const token = await issueDummyToken("separate-dummy-secret", "ABC234", 1000);
  expect(await verifyDummyToken(token, "separate-dummy-secret", "ABC234", 2000)).toBe(true);
  expect(await verifyDummyToken(token, "separate-dummy-secret", "XYZ234", 2000)).toBe(false);
  expect(await verifyDummyToken(token + "x", "separate-dummy-secret", "ABC234", 2000)).toBe(false);
  expect(await verifyDummyToken(token, "rotated", "ABC234", 2000)).toBe(false);
  expect(await verifyDummyToken(token, "separate-dummy-secret", "ABC234", 3601000)).toBe(false);
  expect(await verifyDummyToken(token, undefined, "ABC234", 2000)).toBe(false);
});
