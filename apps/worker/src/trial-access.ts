const encode = (value: ArrayBuffer) => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
const keyFor = (secret: string) => crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export async function issueTrialCookie(secret: string, now: number) {
  const payload = `${now + 86400000}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), new TextEncoder().encode(payload));
  return `${payload}.${encode(signature)}`;
}
export async function verifyTrialCookie(cookie: string | undefined, secret: string, now: number) {
  if (!cookie || cookie.length > 160) return false;
  const [expiry, nonce, signature] = cookie.split(".");
  if (!expiry || !nonce || !signature || !/^[0-9a-f]{64}$/.test(signature) || Number(expiry) <= now || Number(expiry) > now + 86400000) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await keyFor(secret), bytes, new TextEncoder().encode(`${expiry}.${nonce}`));
}
export async function verifyTrialCode(provided: string, expected: string) {
  if (!provided || provided.length > 128) return false;
  const challenge = new TextEncoder().encode("WebFlipper trial access");
  const signature = await crypto.subtle.sign("HMAC", await keyFor(expected), challenge);
  return crypto.subtle.verify("HMAC", await keyFor(provided), signature, challenge);
}
export function safeTrialPath(next: string) {
  return /^\/(?!\/)/.test(next) && !/[\\\u0000-\u0020\u007f]/.test(next) ? next : "/";
}
export function trialPage(next: string, error = false) {
  const safeNext = safeTrialPath(next);
  const escaped = safeNext.replace(/[&"<>]/g, character => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[character]!));
  return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>WebFlipper 限定試用</title><style>body{font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:24px;color:#142338}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:16px;font:inherit}button{background:#0868d9;color:white;border:0}p{line-height:1.8}</style><h1>WebFlipper</h1><p>限定試用です。共有された試用コードを入力してください。</p>${error ? "<p role=alert>試用コードを確認してください。</p>" : ""}<form action="/trial/login" method="post"><input type="hidden" name="next" value="${escaped}"><label>試用コード<input name="code" type="password" required maxlength="128" autocomplete="current-password"></label><button>利用を開始</button></form></html>`, { status: error ? 403 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'", "referrer-policy": "same-origin" } });
}
