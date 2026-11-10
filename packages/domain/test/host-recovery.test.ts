import { expect, it } from "vitest";
import { createRoomEngine } from "../src/index";

it("locks reception during host absence and resumes with the same remaining time", () => {
  const engine = createRoomEngine({ roomId: "r", roomCode: "ABC234", hostId: "h", capacity: 10, answerSeconds: 60, scoreMode: "none" });
  engine.dispatch({ type: "participant.join", participantId: "p", name: "太郎" });
  engine.dispatch({ type: "round.start", hostId: "h", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: false, startedAt: 1000 });
  engine.dispatch({ type: "host.connection", connected: false, now: 11000 });
  expect(() => engine.dispatch({ type: "answer.confirm", participantId: "p", drawing: { operations: [] } })).toThrow("host_absent");
  engine.dispatch({ type: "host.connection", connected: true, now: 31000 });
  expect(engine.getState().round?.endsAt).toBe(81000);
  expect(engine.getState().hostDisconnectedAt).toBeUndefined();
});
