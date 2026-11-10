import { createTrialLimits } from "./trial-limits";

/** A single limited trial's admission ledger, not a room-state coordinator. */
export class TrialGateDurableObject {
  private readonly limits;
  constructor(state: DurableObjectState) {
    this.limits = createTrialLimits({ get: () => state.storage.get("limits"), put: value => state.storage.put("limits", value) });
  }
  async fetch(request: Request) {
    const input = await request.json() as { action: "refresh" | "command" | "create" | "join" | "release" | "blobRead" | "blobWrite"; actor: string; roomCode?: string };
    if (input.action === "release") { await this.limits.releaseRoom(input.roomCode); return Response.json({ allowed: true }); }
    if (!["refresh", "command", "create", "join", "blobRead", "blobWrite"].includes(input.action) || typeof input.actor !== "string" || input.actor.length > 128) return new Response(null, { status: 400 });
    const result = await this.limits.admit(input.action, input.actor, Date.now(), input.roomCode);
    return Response.json(result, { status: result.allowed ? 200 : 429, headers: { "retry-after": String(result.retryAfter) } });
  }
}
