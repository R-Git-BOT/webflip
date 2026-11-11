import { expect, it } from "vitest";
import worker from "../src/index";
import { issueDummyToken } from "../src/dummy-access";
import { createTrialLimits } from "../src/trial-limits";

it("accepts room-scoped dummy authentication but never treats a self-declared dummy as trusted", async () => {
  let stored: unknown;
  const limits = createTrialLimits({ async get() { return stored; }, async put(v) { stored = v; } });
  const env = {
    TRIAL_MODE: "on", TRIAL_CODE: "trial-test", DUMMY_ACCESS_SECRET: "dummy-test-secret",
    REQUEST_LIMITER: { async limit() { return { success: true }; } },
    LOGIN_LIMITER: { async limit() { return { success: true }; } },
    TRIAL_GATE: { idFromName: (n: string) => n, get: () => ({ async fetch(r: Request) {
      const input = await r.json() as any;
      const result = await limits.admit(input.action, input.actor, Date.now(), input.roomCode, input.dummyAuthorized);
      return Response.json(result, { status: result.allowed ? 200 : 429 });
    } }) },
    ROOMS: { idFromName: (n: string) => n, get: () => ({ async fetch() { return Response.json({ snapshot: { room: { roomCode: "ABC234" } } }); } }) }
  } as any;
  const token = await issueDummyToken(env.DUMMY_ACCESS_SECRET, "ABC234", Date.now());
  for (let i = 0; i < 50; i++) {
    const response = await worker.fetch(new Request("https://quiz.test/api/rooms/ABC234/join", { method: "POST", headers: { "x-wf-dummy-token": token }, body: JSON.stringify({ name: `dummy-${i}` }) }), env);
    expect(response.status).toBe(200);
  }
  for (const [path, authorization] of [["/api/rooms/XYZ234/join", token], ["/api/rooms/ABC234/join", "dummy"], ["/api/rooms", token]]) {
    expect((await worker.fetch(new Request(`https://quiz.test${path}`, { method: "POST", headers: { "x-wf-dummy-token": authorization! }, body: "{}" }), env)).status).toBe(403);
  }
});
