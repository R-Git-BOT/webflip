import { createTrialLimits } from "./trial-limits";
import { createDiscordAuthStore } from "./discord-auth-store";
import type { DiscordIdentity } from "./discord-oauth";

/** A single limited trial's admission ledger, not a room-state coordinator. */
export class TrialGateDurableObject {
  private readonly limits;
  private readonly discord;
  constructor(private readonly state: DurableObjectState) {
    this.limits = createTrialLimits({ get: () => state.storage.get("limits"), put: value => state.storage.put("limits", value) });
    this.discord = createDiscordAuthStore({ get: () => state.storage.get("discord-auth"), put: async value => {
      const data = value as { states: Record<string, { expires: number }>; grants: Record<string, { expires: number }> };
      const expiries = [...Object.values(data.states), ...Object.values(data.grants)].map(item => item.expires);
      if (expiries.length) { await state.storage.put("discord-auth", data); await state.storage.setAlarm(Math.max(Date.now() + 100, Math.min(...expiries))); }
      else { await state.storage.delete("discord-auth"); await state.storage.deleteAlarm(); }
    } });
  }
  async fetch(request: Request) {
    const input = await request.json() as { action: string; actor: string; roomCode?: string; dummyAuthorized?: boolean; key?: string; next?: string; identity?: DiscordIdentity };
    const now = Date.now();
    if (input.action === "discord.begin") return Response.json({ value: await this.discord.begin(input.next ?? "/", now) });
    if (input.action === "discord.state") return Response.json({ value: await this.discord.consumeState(input.key ?? "", now) });
    if (input.action === "discord.issue") { if (!input.identity) return new Response(null, { status: 400 }); return Response.json({ value: await this.discord.issueGrant(input.identity, now) }); }
    if (input.action === "discord.read") return Response.json({ value: await this.discord.getGrant(input.key ?? "", now) });
    if (input.action === "discord.consume") return Response.json({ value: await this.discord.consumeGrant(input.key ?? "", now) });
    if (input.action === "release") { await this.limits.releaseRoom(input.roomCode); return Response.json({ allowed: true }); }
    if (!["refresh", "command", "create", "join", "blobRead", "blobWrite"].includes(input.action) || typeof input.actor !== "string" || input.actor.length > 128) return new Response(null, { status: 400 });
    const result = await this.limits.admit(input.action as "refresh" | "command" | "create" | "join" | "blobRead" | "blobWrite", input.actor, now, input.roomCode, input.dummyAuthorized === true);
    return Response.json(result, { status: result.allowed ? 200 : 429, headers: { "retry-after": String(result.retryAfter) } });
  }
  async alarm() { await this.discord.cleanup(Date.now()); }
}
