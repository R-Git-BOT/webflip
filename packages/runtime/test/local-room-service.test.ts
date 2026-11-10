import { describe, expect, it } from "vitest";
import { createLocalRoomService } from "../src/index";

describe("LocalRoomService", () => {
  it("lets the host detach from an ended room without removing other participants' ended screens", () => {
    const service = createLocalRoomService({ nextId: () => crypto.randomUUID(), nextRoomCode: () => "ABC234" });
    const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
    const guest = service.joinRoom({ roomCode: "ABC234", name: "参加者" });
    expect(() => service.leaveRoom(host.sessionId)).toThrow("participant_required");
    service.dispatch(host.sessionId, { type: "room.end" });
    expect(service.leaveRoom(host.sessionId)).toEqual({ roomCode: "ABC234" });
    expect(() => service.getSnapshot(host.sessionId)).toThrow("session_not_found");
    expect(service.getSnapshot(guest.sessionId).room.phase).toBe("ended");
  });
  it("removes every disconnected answer before a bulk removal closes reception", () => {
    const service = createLocalRoomService({ nextId: () => crypto.randomUUID(), nextRoomCode: () => "ABC234" });
    const host = service.createRoom({ capacity: 50, answerSeconds: 60, scoreMode: "none" });
    const online = service.joinRoom({ roomCode: "ABC234", name: "接続中" });
    const pending = service.joinRoom({ roomCode: "ABC234", name: "切断・未確定" });
    const confirmed = service.joinRoom({ roomCode: "ABC234", name: "切断・確定済み" });
    const onlineId = service.getSnapshot(online.sessionId).participantId;
    service.dispatch(host.sessionId, { type: "round.start", prompt: "空", answerSeconds: 60, revealNamesDuringJudging: true });
    service.dispatch(online.sessionId, { type: "answer.confirm", drawing: { operations: [] } });
    service.dispatch(confirmed.sessionId, { type: "answer.confirm", drawing: { operations: [] } });
    service.setConnection(pending.sessionId, false, Date.now());
    service.setConnection(confirmed.sessionId, false, Date.now());
    service.dispatch(host.sessionId, { type: "participants.removeDisconnected" });
    const result = service.getSnapshot(host.sessionId).room;
    expect(result.phase).toBe("judging");
    expect(result.round?.answers.map(answer => answer.participantId)).toEqual([onlineId]);
  });
  it("lets the host remove disconnected participants in one operation while preserving connected participants", () => {
    const service = createLocalRoomService({ nextId: () => crypto.randomUUID(), nextRoomCode: () => "ABC234" });
    const host = service.createRoom({ capacity: 50, answerSeconds: 60, scoreMode: "none" });
    const online = service.joinRoom({ roomCode: "ABC234", name: "接続中" });
    const first = service.joinRoom({ roomCode: "ABC234", name: "切断1" });
    const second = service.joinRoom({ roomCode: "ABC234", name: "切断2" });
    service.setConnection(first.sessionId, false, Date.now());
    service.setConnection(second.sessionId, false, Date.now());
    expect(() => service.dispatch(online.sessionId, { type: "participants.removeDisconnected" })).toThrow("host_required");
    service.dispatch(host.sessionId, { type: "participants.removeDisconnected" });
    expect(service.getSnapshot(host.sessionId).room.participants.map(p => p.name)).toEqual(["接続中"]);
    expect(() => service.getSnapshot(first.sessionId)).toThrow("session_not_found");
    expect(() => service.getSnapshot(second.sessionId)).toThrow("session_not_found");
    expect(service.dispatch(host.sessionId, { type: "participants.removeDisconnected" })).toEqual({ ok: true });
  });
  it("lets only the host remove a participant and revokes the removed session", () => {
    const service = createLocalRoomService({ nextId: () => crypto.randomUUID(), nextRoomCode: () => "ABC234" });
    const host = service.createRoom({ capacity: 50, answerSeconds: 60, scoreMode: "none" });
    const first = service.joinRoom({ roomCode: "ABC234", name: "ダミー参加者2" });
    const second = service.joinRoom({ roomCode: "ABC234", name: "別の参加者" });
    const id = service.getSnapshot(first.sessionId).participantId!;
    expect(() => service.dispatch(second.sessionId, { type: "participant.remove", participantId: id })).toThrow("host_required");
    service.dispatch(host.sessionId, { type: "participant.remove", participantId: id });
    expect(service.getSnapshot(host.sessionId).room.participants.map(p => p.name)).toEqual(["別の参加者"]);
    expect(() => service.getSnapshot(first.sessionId)).toThrow("session_not_found");
    expect(() => service.joinRoom({ roomCode: "ABC234", name: "再参加", previousSessionId: first.sessionId })).toThrow("participant_excluded");
  });
  it("does not grant host authority from public room identifiers", () => {
    let id = 0;
    const service = createLocalRoomService({ nextId: () => `id-${++id}`, nextRoomCode: () => "ABC234" });
    service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
    const guest = service.joinRoom({ roomCode: "ABC234", name: "太郎" });
    const publicRoom = service.getSnapshot(guest.sessionId).room;
    expect(() => service.dispatch(`host:${publicRoom.hostId}`, { type: "room.end" })).toThrow("session_not_found");
  });
  it("lets a host and participant observe the same in-memory room", () => {
    const service = createLocalRoomService({
      nextId: (() => {
        const ids = ["room-1", "host-1", "participant-1"];
        return () => ids.shift() ?? "unused";
      })(),
      nextRoomCode: () => "K7M4PX"
    });

    const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
    const participant = service.joinRoom({ roomCode: host.roomCode, name: "たろう" });

    expect(service.getSnapshot(host.sessionId)).toMatchObject({
      role: "host",
      room: { roomCode: "K7M4PX", participants: [{ name: "たろう" }] }
    });
    expect(service.getSnapshot(participant.sessionId)).toMatchObject({
      role: "participant",
      participantId: "participant-1",
      room: { roomCode: "K7M4PX", participants: [{ name: "たろう" }] }
    });
  });

  it("routes host and participant commands through their sessions", () => {
    let nextId = 0;
    const service = createLocalRoomService({
      nextId: () => `id-${++nextId}`,
      nextRoomCode: () => "K7M4PX"
    });
    const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
    const participant = service.joinRoom({ roomCode: host.roomCode, name: "たろう" });

    service.dispatch(host.sessionId, {
      type: "round.start",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });
    service.dispatch(participant.sessionId, {
      type: "draft.save",
      drawing: { operations: [{ kind: "stroke", points: [[1, 2], [3, 4]] }] }
    });
    expect(service.getSnapshot(host.sessionId).room.round?.answers).toMatchObject([
      { participantId: "id-3", confirmed: false }
    ]);
    service.dispatch(participant.sessionId, {
      type: "answer.confirm",
      drawing: { operations: [] }
    });

    expect(service.getSnapshot(host.sessionId).room.phase).toBe("judging");
  });

  it("routes judging, publishing, and next-round commands for the host", () => {
    let nextId = 0;
    const service = createLocalRoomService({
      nextId: () => `id-${++nextId}`,
      nextRoomCode: () => "K7M4PX"
    });
    const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "correct-count" });
    const participant = service.joinRoom({ roomCode: host.roomCode, name: "たろう" });
    service.dispatch(host.sessionId, {
      type: "round.start",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });
    service.dispatch(participant.sessionId, { type: "answer.confirm", drawing: { operations: [] } });
    service.dispatch(host.sessionId, { type: "answer.toggleCorrect", participantId: "id-3" });
    service.dispatch(host.sessionId, { type: "results.publish" });

    expect(service.getSnapshot(host.sessionId).room).toMatchObject({
      phase: "results",
      participants: [{ id: "id-3", correctCount: 1 }]
    });

    service.dispatch(host.sessionId, { type: "round.next" });
    expect(service.getSnapshot(host.sessionId).room).toMatchObject({ phase: "waiting", round: null });
  });

  it("does not expose other participants' drawings before judging", () => {
    let nextId = 0;
    const service = createLocalRoomService({
      nextId: () => `id-${++nextId}`,
      nextRoomCode: () => "K7M4PX"
    });
    const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
    const first = service.joinRoom({ roomCode: host.roomCode, name: "たろう" });
    const second = service.joinRoom({ roomCode: host.roomCode, name: "ゆかぴ" });
    service.dispatch(host.sessionId, {
      type: "round.start",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false
    });
    service.dispatch(first.sessionId, {
      type: "draft.save",
      drawing: { operations: [{ kind: "stroke", points: [[1, 2]] }] }
    });

    expect(service.getSnapshot(second.sessionId).room.round?.answers).toEqual([]);
    expect(service.getSnapshot(first.sessionId).room.round?.answers).toHaveLength(1);
    expect(service.getSnapshot(host.sessionId).room.round?.answers).toEqual([
      { participantId: "id-3", confirmed: false, drawing: { operations: [] } }
    ]);
  });

  it("closes answer reception when the server-authoritative deadline passes", () => {
    let nextId = 0;
    const service = createLocalRoomService({
      nextId: () => `id-${++nextId}`,
      nextRoomCode: () => "K7M4PX"
    });
    const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
    service.joinRoom({ roomCode: host.roomCode, name: "たろう" });
    service.dispatch(host.sessionId, {
      type: "round.start",
      prompt: "空を飛ぶもの",
      answerSeconds: 60,
      revealNamesDuringJudging: false,
      startedAt: 1_000
    });

    expect(service.expireDueRounds(60_999)).toEqual([]);
    expect(service.expireDueRounds(61_000)).toEqual(["K7M4PX"]);
    expect(service.getSnapshot(host.sessionId).room.phase).toBe("judging");
  });

  it("removes an exiting participant session and updates the host snapshot", () => {
    let nextId = 0;
    const service = createLocalRoomService({
      nextId: () => `id-${++nextId}`,
      nextRoomCode: () => "K7M4PX"
    });
    const host = service.createRoom({ capacity: 10, answerSeconds: 60, scoreMode: "none" });
    const participant = service.joinRoom({ roomCode: host.roomCode, name: "たろう" });

    expect(service.leaveRoom(participant.sessionId)).toEqual({ roomCode: "K7M4PX" });
    expect(service.getSnapshot(host.sessionId).room.participants).toEqual([]);
    expect(() => service.getSnapshot(participant.sessionId)).toThrow("session_not_found");
  });
});
