import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { validatePngDataUrl } from "../src/png";
function chunk(kind: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(kind), data]);
  let crc = -1;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ -1) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
function fixture(alpha = 255, extra = 0) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1024); header.writeUInt32BE(768, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(768 * 4097 + extra);
  for (let y = 0; y < 768; y++) for (let x = 0; x < 1024; x++) raw[y * 4097 + 1 + x * 4 + 3] = alpha;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
it("accepts a 1024x768 opaque PNG and rejects transparent or oversized decoded data", async () => {
  await expect(validatePngDataUrl(fixture())).resolves.toBeUndefined();
  await expect(validatePngDataUrl(fixture(0))).rejects.toThrow("invalid_png");
  await expect(validatePngDataUrl(fixture(255, 1))).rejects.toThrow("invalid_png");
  await expect(validatePngDataUrl(fixture().slice(0, -12))).rejects.toThrow("invalid_png");
});
