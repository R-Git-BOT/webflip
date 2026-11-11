import { createHmac, randomUUID } from "node:crypto";
/** Wire format shared with the Worker's verifier; this issuer is never bundled into the web UI. */
export function issueFleetToken(secret: string, room: string, now: number) {
  const payload = `dummy-v1.${room}.${now + 3600000}.${randomUUID()}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}
