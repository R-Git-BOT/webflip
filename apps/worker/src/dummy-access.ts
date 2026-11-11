const key = (secret: string) => crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export async function issueDummyToken(secret: string, room: string, now: number) {
  if (!/^[A-Z0-9]{6}$/.test(room)) throw Error("invalid_room_code");
  const payload = `dummy-v1.${room}.${now + 3600000}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(payload));
  return `${payload}.${Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("")}`;
}
export async function verifyDummyToken(token: string | null, secret: string | undefined, room: string | undefined, now: number) {
  if (!secret || !token || token.length > 200 || !room) return false;
  const parts = token.split(".");
  if (parts.length !== 5) return false;
  const [version, boundRoom, expiry, nonce, signature] = parts;
  if (version !== "dummy-v1" || boundRoom !== room || !nonce || !signature || !/^[0-9a-f]{64}$/.test(signature) || !/^\d+$/.test(expiry!) || Number(expiry) <= now || Number(expiry) > now + 3600000) return false;
  return crypto.subtle.verify("HMAC", await key(secret), Uint8Array.from(signature.match(/../g)!, b => parseInt(b, 16)), new TextEncoder().encode(parts.slice(0, 4).join(".")));
}
