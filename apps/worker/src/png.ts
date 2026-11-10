const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export async function validatePngDataUrl(value: unknown): Promise<void> {
  const invalid = () => { throw new Error("invalid_png"); };
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,") || value.length > 350000) invalid();
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob((value as string).slice(22)), character => character.charCodeAt(0)); } catch { return invalid(); }
  if (bytes.length < 45 || [137,80,78,71,13,10,26,10].some((n, i) => bytes[i] !== n)) invalid();
  const view = new DataView(bytes.buffer);
  const compressed: Uint8Array[] = [];
  let offset = 8;
  let channels = 0;
  let ended = false;
  let seenData = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) invalid();
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (let i = offset + 4; i < offset + 8 + length; i++) crc = crcTable[(crc ^ bytes[i]!) & 255]! ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(offset + 8 + length)) invalid();
    if (offset === 8) {
      if (kind !== "IHDR" || length !== 13 || view.getUint32(offset + 8) !== 1024 || view.getUint32(offset + 12) !== 768 || bytes[offset + 16] !== 8 || ![2,6].includes(bytes[offset + 17]!) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] !== 0) invalid();
      channels = bytes[offset + 17] === 6 ? 4 : 3;
    } else if (kind === "IHDR" || kind === "tRNS" || kind === "acTL") invalid();
    if (kind === "IDAT") { seenData = true; compressed.push(bytes.slice(offset + 8, offset + 8 + length)); }
    if (kind === "IEND") { if (length !== 0 || !seenData || offset + 12 !== bytes.length) invalid(); ended = true; break; }
    offset += length + 12;
  }
  if (!ended) invalid();
  const stride = 1024 * channels + 1;
  const expected = stride * 768;
  const reader = new Blob(compressed).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const raw = new Uint8Array(expected);
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.length > expected) { await reader.cancel(); invalid(); }
      raw.set(chunk.value, size); size += chunk.value.length;
    }
  } catch { return invalid(); }
  if (size !== expected) invalid();
  for (let y = 0; y < 768; y++) {
    const filter = raw[y * stride]!;
    if (filter > 4) invalid();
    if (channels !== 4) continue;
    for (let x = 0; x < 1024; x++) {
      const left = x ? 255 : 0, up = y ? 255 : 0, upperLeft = x && y ? 255 : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      if (filter === 2) prediction = up;
      if (filter === 3) prediction = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - upperLeft;
        const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        prediction = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      if (((raw[y * stride + 1 + x * 4 + 3]! + prediction) & 255) !== 255) invalid();
    }
  }
}
