export type DiscordIdentity = { id: string; displayName: string; avatar: string | null };
type Config = { clientId: string; clientSecret: string; redirectUri: string };

/** The returned identity contains no OAuth token; it is never an authentication credential. */
export function createDiscordOAuth(config: Config, fetchDiscord: typeof fetch = fetch) {
  return {
    authorizeUrl(state: string) {
      const url = new URL("https://discord.com/oauth2/authorize");
      url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: "identify", state }).toString();
      return url.toString();
    },
    async exchange(code: string): Promise<DiscordIdentity> {
      const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, redirect_uri: config.redirectUri });
      const tokenResponse = await fetchDiscord("https://discord.com/api/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
      if (!tokenResponse.ok) throw new Error("discord_token_failed");
      const token = await tokenResponse.json() as { access_token?: unknown; token_type?: unknown };
      if (typeof token.access_token !== "string" || token.access_token.length === 0 || token.access_token.length > 2048 || token.token_type !== "Bearer") throw new Error("discord_token_failed");
      const userResponse = await fetchDiscord("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${token.access_token}` } });
      if (!userResponse.ok) throw new Error("discord_identity_failed");
      const user = await userResponse.json() as { id?: unknown; username?: unknown; global_name?: unknown; avatar?: unknown };
      if (typeof user.id !== "string" || !/^\d{1,20}$/.test(user.id) || typeof user.username !== "string" || user.username.length === 0 || user.username.length > 100 || (user.avatar !== null && user.avatar !== undefined && (typeof user.avatar !== "string" || !/^(?:a_)?[a-f0-9]{1,64}$/.test(user.avatar)))) throw new Error("discord_identity_invalid");
      const displayName = typeof user.global_name === "string" && user.global_name.length > 0 && user.global_name.length <= 100 ? user.global_name : user.username;
      return { id: user.id, displayName, avatar: typeof user.avatar === "string" ? user.avatar : null };
    }
  };
}
