import { expect, it, vi } from "vitest";
import { createDiscordOAuth } from "../src/discord-oauth";

it("requests only identify and exchanges the authorization code for a validated Discord identity", async () => {
  const fetchDiscord = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://discord.com/api/oauth2/token") {
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("example-code");
      expect(body.get("redirect_uri")).toBe("https://example.test/api/discord/callback");
      return Response.json({ access_token: "temporary-token", token_type: "Bearer" });
    }
    expect(url).toBe("https://discord.com/api/v10/users/@me");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer temporary-token");
    return Response.json({ id: "123456789012345678", username: "user", global_name: "表示名", avatar: "abcdef123" });
  });
  const oauth = createDiscordOAuth({ clientId: "1234567890", clientSecret: "secret", redirectUri: "https://example.test/api/discord/callback" }, fetchDiscord);
  const url = new URL(oauth.authorizeUrl("state-value"));
  expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
  expect(url.searchParams.get("scope")).toBe("identify");
  expect(url.searchParams.get("state")).toBe("state-value");
  expect(await oauth.exchange("example-code")).toEqual({ id: "123456789012345678", displayName: "表示名", avatar: "abcdef123" });
});

it("rejects failed exchanges and invalid user identity responses", async () => {
  const config = { clientId: "1234567890", clientSecret: "secret", redirectUri: "https://example.test/api/discord/callback" };
  await expect(createDiscordOAuth(config, async () => new Response(null, { status: 401 })).exchange("bad")).rejects.toThrow("discord_token_failed");
  let calls = 0;
  const oauth = createDiscordOAuth(config, async () => ++calls === 1 ? Response.json({ access_token: "temporary-token", token_type: "Bearer" }) : Response.json({ id: "invalid", username: "user" }));
  await expect(oauth.exchange("code")).rejects.toThrow("discord_identity_invalid");
});
