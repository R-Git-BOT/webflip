import { describe, expect, it } from "vitest";
import { createRoomEngine } from "../src/index";

describe("RoomEngine", () => {
  it("starts another question directly from results and discards the old answers", () => {
    const engine = createRoomEngine({ roomId: "r", roomCode: "ABC234", hostId: "h", capacity: 10, answerSeconds: 60, scoreMode: "none" });
    engine.dispatch({ type: "participant.join", participantId: "p", name: "参加者" });
    const start = { type: "round.start" as const, hostId: "h", prompt: "一問目", answerSeconds: 60, revealNamesDuringJudging: false };
    engine.dispatch(start);
    engine.dispatch({ type: "round.close", hostId: "h" });
    engine.dispatch({ type: "results.publish", hostId: "h" });
    engine.dispatch({ ...start, prompt: "二問目" });
    expect(engine.getState()).toMatchObject({ phase: "answering", completedRounds: 1, round: { prompt: "二問目", correctParticipantIds: [] } });
  });
  it.each([6, 9, 11, 49, 51, 55, 10.5])("rejects new rooms with unsupported capacity %i", capacity => {
    expect(() => createRoomEngine({ roomId: "r", roomCode: "ABC234", hostId: "h", capacity, answerSeconds: 60, scoreMode: "none" })).toThrow("invalid_settings");
  });
  it("creates a waiting room with the room-only settings", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "correct-count"
    });

    expect(engine.getState()).toMatchObject({
      phase: "waiting",
      settings: {
        capacity: 10,
        answerSeconds: 60,
        scoreMode: "correct-count"
      },
      completedRounds: 0
    });
  });

  it("adds a connected participant to the waiting room", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });

    const result = engine.dispatch({
      type: "participant.join",
      participantId: "participant-1",
      name: "たろう"
    });

    expect(result.ok).toBe(true);
    expect(engine.getState().participants).toEqual([
      {
        id: "participant-1",
        name: "たろう",
        connected: true,
        correctCount: 0
      }
    ]);
  });

  it("starts answer reception with the connected participants fixed as targets", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({
      type: "participant.join",
      participantId: "participant-1",
      name: "たろう"
    });

    const result = engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 90,
      revealNamesDuringJudging: false
    });

    expect(result.ok).toBe(true);
    expect(engine.getState()).toMatchObject({
      phase: "answering",
      round: {
        prompt: "空を飛ぶもの",
        answerSeconds: 90,
        targetParticipantIds: ["participant-1"],
        revealNamesDuringJudging: false
      }
    });
  });

  it("moves to judging exactly when every target participant has confirmed", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });
    engine.dispatch({ type: "participant.join", participantId: "p2", name: "ゆかぴ" });
    engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });

    engine.dispatch({
      type: "answer.confirm",
      participantId: "p1",
      drawing: { operations: [{ kind: "stroke", points: [[10, 20], [30, 40]] }] }
    });
    expect(engine.getState().phase).toBe("answering");

    engine.dispatch({
      type: "answer.confirm",
      participantId: "p2",
      drawing: { operations: [] }
    });

    expect(engine.getState()).toMatchObject({
      phase: "judging",
      round: {
        answers: [
          { participantId: "p1", confirmed: true },
          { participantId: "p2", confirmed: true }
        ],
        locked: true
      }
    });
  });

  it("publishes selected correct answers and increments correct counts", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "correct-count"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });
    engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });
    engine.dispatch({
      type: "answer.confirm",
      participantId: "p1",
      drawing: { operations: [] }
    });

    engine.dispatch({ type: "answer.toggleCorrect", hostId: "host-1", participantId: "p1" });
    engine.dispatch({ type: "results.publish", hostId: "host-1" });

    expect(engine.getState()).toMatchObject({
      phase: "results",
      completedRounds: 1,
      participants: [{ id: "p1", correctCount: 1 }],
      round: { correctParticipantIds: ["p1"] }
    });
  });

  it("lets a participant reopen an answer before simultaneous submission", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });
    engine.dispatch({ type: "participant.join", participantId: "p2", name: "ゆかぴ" });
    engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });
    engine.dispatch({
      type: "answer.confirm",
      participantId: "p1",
      drawing: { operations: [] }
    });

    const result = engine.dispatch({ type: "answer.reopen", participantId: "p1" });

    expect(result.ok).toBe(true);
    expect(engine.getState()).toMatchObject({
      phase: "answering",
      round: {
        answers: [{ participantId: "p1", confirmed: false }],
        locked: false
      }
    });
  });

  it("deletes round data when the host advances to the next waiting state", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });
    engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });
    engine.dispatch({ type: "answer.confirm", participantId: "p1", drawing: { operations: [] } });
    engine.dispatch({ type: "results.publish", hostId: "host-1" });

    engine.dispatch({ type: "round.next", hostId: "host-1" });

    expect(engine.getState()).toMatchObject({
      phase: "waiting",
      completedRounds: 1,
      round: null
    });
  });

  it("saves a draft without confirming the participant answer", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });
    engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });

    engine.dispatch({
      type: "draft.save",
      participantId: "p1",
      drawing: { operations: [{ kind: "stroke", points: [[1, 2], [3, 4]] }] }
    });

    expect(engine.getState()).toMatchObject({
      phase: "answering",
      round: {
        answers: [{ participantId: "p1", confirmed: false }],
        locked: false
      }
    });
  });

  it("rejects a duplicate participant name and a participant beyond capacity", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: " Alice " });

    expect(() => engine.dispatch({ type: "participant.join", participantId: "p2", name: "alice" }))
      .toThrow("name_taken");

    for (let index = 2; index <= 10; index += 1) {
      engine.dispatch({ type: "participant.join", participantId: `p${index}`, name: `参加者${index}` });
    }
    expect(() => engine.dispatch({ type: "participant.join", participantId: "p11", name: "参加者11" }))
      .toThrow("room_full");
  });

  it("submits every current canvas when the host closes reception early", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });
    engine.dispatch({ type: "participant.join", participantId: "p2", name: "ゆかぴ" });
    engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false,
      startedAt: 1_000
    });
    engine.dispatch({ type: "draft.save", participantId: "p1", drawing: { operations: [{ kind: "stroke" }] } });

    engine.dispatch({ type: "round.close", hostId: "host-1" });

    expect(engine.getState()).toMatchObject({
      phase: "judging",
      round: {
        locked: true,
        answers: [
          { participantId: "p1", confirmed: true, drawing: { operations: [{ kind: "stroke" }] } },
          { participantId: "p2", confirmed: true, drawing: { operations: [] } }
        ]
      }
    });
  });

  it("ends a room and removes round and participant data", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });

    engine.dispatch({ type: "room.end", hostId: "host-1" });

    expect(engine.getState()).toMatchObject({ phase: "ended", participants: [], round: null });
  });

  it("removes a participant who exits while the room is waiting", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });

    engine.dispatch({ type: "participant.exit", participantId: "p1" });

    expect(engine.getState()).toMatchObject({ phase: "waiting", participants: [] });
  });

  it("removes an exiting target and submits when every remaining target is confirmed", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });
    engine.dispatch({ type: "participant.join", participantId: "p2", name: "ゆかぴ" });
    engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });
    engine.dispatch({ type: "answer.confirm", participantId: "p1", drawing: { operations: [] } });
    engine.dispatch({ type: "draft.save", participantId: "p2", drawing: { operations: [{ kind: "stroke" }] } });

    engine.dispatch({ type: "participant.exit", participantId: "p2" });

    expect(engine.getState()).toMatchObject({
      phase: "judging",
      participants: [{ id: "p1" }],
      round: {
        targetParticipantIds: ["p1"],
        answers: [{ participantId: "p1" }],
        locked: true
      }
    });
  });

  it("keeps a published answer after exit and removes the participant before the next round", () => {
    const engine = createRoomEngine({
      roomId: "room-1",
      roomCode: "K7M4PX",
      hostId: "host-1",
      capacity: 10,
      answerSeconds: 60,
      scoreMode: "none"
    });
    engine.dispatch({ type: "participant.join", participantId: "p1", name: "たろう" });
    engine.dispatch({
      type: "round.start",
      hostId: "host-1",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });
    engine.dispatch({ type: "answer.confirm", participantId: "p1", drawing: { operations: [] } });
    engine.dispatch({ type: "results.publish", hostId: "host-1" });

    engine.dispatch({ type: "participant.exit", participantId: "p1" });
    expect(engine.getState()).toMatchObject({
      phase: "results",
      participants: [{ id: "p1", name: "たろう", connected: false, left: true }],
      round: { answers: [{ participantId: "p1" }] }
    });

    engine.dispatch({ type: "round.next", hostId: "host-1" });
    expect(engine.getState().participants).toEqual([]);
  });
});
