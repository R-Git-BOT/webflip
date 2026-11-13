import type { DiscordIdentity } from "./discord-oauth";
import { safeTrialPath } from "./trial-access";

type Store = {
  begin(next: string, now: number): Promise<string>;
  consumeState(key: string, now: number): Promise<string | null>;
  issueGrant(identity: DiscordIdentity, now: number): Promise<string>;
};
type OAuth = { authorizeUrl(state: string): string; exchange(code: string): Promise<DiscordIdentity> };
const cookieValue = (request: Request, name: string) => request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

export function createDiscordAuthHttp(store: Store, oauth: OAuth) {
  return {
    async start(request: Request, now: number) {
      const next = safeTrialPath(new URL(request.url).searchParams.get("next") ?? "/");
      const state = await store.begin(next, now);
      return new Response(null, { status: 303, headers: { location: oauth.authorizeUrl(state), "set-cookie": cookie("wf_discord_state", state, 300), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    },
    async callback(request: Request, now: number) {
      const url = new URL(request.url);
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const issuer = url.searchParams.get("iss");
      if ((issuer && issuer !== "https://discord.com") || !/^[a-f0-9]{64}$/.test(state) || cookieValue(request, "wf_discord_state") !== state || code.length < 1 || code.length > 512) return Response.json({ error: "discord_state_invalid" }, { status: 400, headers: { "cache-control": "no-store" } });
      const next = await store.consumeState(state, now);
      if (next === null) return Response.json({ error: "discord_state_invalid" }, { status: 400, headers: { "cache-control": "no-store" } });
      const identity = await oauth.exchange(code);
      const grant = await store.issueGrant(identity, now);
      const headers = new Headers({ location: next, "cache-control": "no-store", "referrer-policy": "no-referrer" });
      headers.append("set-cookie", cookie("wf_discord_state", "", 0));
      headers.append("set-cookie", cookie("wf_discord", grant, 300));
      return new Response(null, { status: 303, headers });
    }
  };
}
