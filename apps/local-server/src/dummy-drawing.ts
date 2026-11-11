import { deflateSync } from "node:zlib";
const random = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([head, body, tail]);
}
export function createFleetDrawing() {
  const operations = Array.from({ length: random(2, 5) }, () => ({ kind: "stroke" as const, points: Array.from({ length: 4 }, () => [random(120, 904), random(100, 668)] as [number, number]) }));
  const stride = 3073, raw = Buffer.alloc(stride * 768);
  for (let y = 0; y < 768; y++) for (let x = 0; x < 1024; x++) {
    const offset = y * stride + x * 3 + 1; raw[offset] = 8; raw[offset + 1] = 104; raw[offset + 2] = 217;
  }
  const dot = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const px = x + dx, py = y + dy;
      if (dx * dx + dy * dy > 16 || px < 0 || py < 0 || px >= 1024 || py >= 768) continue;
      const offset = py * stride + px * 3 + 1; raw[offset] = raw[offset + 1] = raw[offset + 2] = 255;
    }
  };
  for (const op of operations) for (let i = 1; i < op.points.length; i++) {
    const [ax, ay] = op.points[i - 1]!, [bx, by] = op.points[i]!;
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
    for (let t = 0; t <= steps; t++) dot(Math.round(ax + (bx - ax) * t / steps), Math.round(ay + (by - ay) * t / steps));
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1024); header.writeUInt32BE(768, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return { operations, redoOperations: [], pngDataUrl: `data:image/png;base64,${png.toString("base64")}` };
}
