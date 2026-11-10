import {
  createRoomEngine,
  type RoomEngine,
  type RoomState,
  type ScoreMode
} from "@webflipper/domain";

type LocalRoomServiceDependencies = {
  nextId(): string;
  nextRoomCode(): string;
};

type Session =
  | { role: "host"; roomCode: string; hostId: string }
  | { role: "participant"; roomCode: string; participantId: string };

export type RoomSnapshot = {
  role: Session["role"];
  participantId?: string;
  room: RoomState;
};

export type LocalRoomService = {
  setStorageAvailability(available: boolean, now: number): void;
  setConnection(sessionId: string, connected: boolean, now: number): void;
  exportState(): PersistedRoomService;
  createRoom(settings: {
    capacity: number;
    answerSeconds: number;
    scoreMode: ScoreMode;
  }): { roomCode: string; sessionId: string };
  joinRoom(input: { roomCode: string; name: string }): { sessionId: string };
  leaveRoom(sessionId: string): { roomCode: string };
  getSnapshot(sessionId: string): RoomSnapshot;
  dispatch(sessionId: string, command: LocalCommand): { ok: true };
  expireDueRounds(now: number): string[];
};

export type PersistedRoomService = {
  receipts?: Record<string, { sessionId: string; fingerprint: string }>;
  rooms: [string, RoomState][];
  sessions: [string, Session][];
};

export type LocalCommand =
  | {
      type: "round.start";
      prompt: string;
      answerSeconds: number;
      revealNamesDuringJudging: boolean;
      startedAt?: number;
    }
  | {
      type: "answer.confirm";
      drawing: { operations: unknown[] };
    }
  | {
      type: "draft.save";
      drawing: { operations: unknown[] };
    }
  | { type: "answer.reopen" }
  | { type: "answer.toggleCorrect"; participantId: string }
  | { type: "results.publish" }
  | { type: "round.next" }
  | { type: "round.close" }
  | { type: "room.end" };

function visibleRoom(room: RoomState, session: Session): RoomState {
  const visible = structuredClone(room);
  if (!visible.round || visible.phase === "results" || visible.phase === "ended") return visible;

  if (visible.phase === "answering") {
    if (session.role === "participant") {
      visible.round.answers = visible.round.answers.filter(
        (answer) => answer.participantId === session.participantId
      );
    } else {
      visible.round.answers = visible.round.answers.map((answer) => ({
        ...answer,
        drawing: { operations: [] }
      }));
    }
  }

  if (visible.phase === "judging" && session.role === "participant") {
    visible.round.answers = visible.round.answers.filter(
      (answer) => answer.participantId === session.participantId
    );
    visible.round.correctParticipantIds = [];
  }
  return visible;
}

export function createLocalRoomService(
  dependencies: LocalRoomServiceDependencies,
  persisted?: PersistedRoomService
): LocalRoomService {
  const rooms = new Map<string, RoomEngine>();
  const sessions = new Map<string, Session>();
  const receipts = structuredClone(persisted?.receipts ?? {});
  for (const [code, state] of persisted?.rooms ?? []) {
    rooms.set(code, createRoomEngine({ ...state.settings, roomId: state.roomId, roomCode: code, hostId: state.hostId }, state));
  }
  for (const [id, session] of persisted?.sessions ?? []) sessions.set(id, session);

  return {
    setStorageAvailability(available, now) {
      for (const room of rooms.values()) room.dispatch({ type: "storage.connection", available, now });
    },
    setConnection(sessionId, connected, now) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("session_not_found");
      const room = rooms.get(session.roomCode);
      if (!room) throw new Error("room_not_found");
      room.dispatch(session.role === "host" ? { type: "host.connection", connected, now } : { type: "participant.connection", participantId: session.participantId, connected });
    },
    exportState() {
      return structuredClone({ rooms: [...rooms].map(([code, engine]) => [code, engine.getState()] as [string, RoomState]), sessions: [...sessions], receipts });
    },
    createRoom(settings) {
      const roomId = dependencies.nextId();
      const hostId = dependencies.nextId();
      const roomCode = dependencies.nextRoomCode();
      const sessionId = crypto.randomUUID();
      rooms.set(
        roomCode,
        createRoomEngine({ roomId, roomCode, hostId, ...settings })
      );
      sessions.set(sessionId, { role: "host", roomCode, hostId });
      return { roomCode, sessionId };
    },
    joinRoom(input) {
      const room = rooms.get(input.roomCode);
      if (!room) throw new Error("room_not_found");
      const participantId = dependencies.nextId();
      const sessionId = crypto.randomUUID();
      room.dispatch({
        type: "participant.join",
        participantId,
        name: input.name
      });
      sessions.set(sessionId, {
        role: "participant",
        roomCode: input.roomCode,
        participantId
      });
      return { sessionId };
    },
    leaveRoom(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("session_not_found");
      if (session.role !== "participant") throw new Error("participant_required");
      const room = rooms.get(session.roomCode);
      if (!room) throw new Error("room_not_found");
      room.dispatch({ type: "participant.exit", participantId: session.participantId });
      sessions.delete(sessionId);
      return { roomCode: session.roomCode };
    },
    getSnapshot(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("session_not_found");
      const room = rooms.get(session.roomCode);
      if (!room) throw new Error("room_not_found");
      return {
        role: session.role,
        ...(session.role === "participant"
          ? { participantId: session.participantId }
          : {}),
        room: visibleRoom(room.getState(), session)
      };
    },
    dispatch(sessionId, command) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("session_not_found");
      const room = rooms.get(session.roomCode);
      if (!room) throw new Error("room_not_found");

      if (command.type === "round.start") {
        if (session.role !== "host") throw new Error("host_required");
        return room.dispatch({
          ...command,
          hostId: session.hostId
        });
      }

      if (
        command.type === "answer.toggleCorrect" ||
        command.type === "results.publish" ||
        command.type === "round.next" ||
        command.type === "round.close" ||
        command.type === "room.end"
      ) {
        if (session.role !== "host") throw new Error("host_required");
        return room.dispatch({ ...command, hostId: session.hostId });
      }

      if (session.role !== "participant") throw new Error("participant_required");
      if (command.type === "answer.reopen") {
        return room.dispatch({ type: "answer.reopen", participantId: session.participantId });
      }
      return room.dispatch({ ...command, participantId: session.participantId });
    },
    expireDueRounds(now) {
      const expiredRoomCodes: string[] = [];
      for (const [roomCode, room] of rooms) {
        const state = room.getState();
        if (state.phase === "ended") {
          if (state.endedAt !== undefined && now >= state.endedAt + 300_000) {
            rooms.delete(roomCode);
            for (const [id, session] of sessions) if (session.roomCode === roomCode) sessions.delete(id);
            expiredRoomCodes.push(roomCode);
          }
          continue;
        }
        if (state.hostDisconnectedAt !== undefined || state.storagePausedAt !== undefined) {
          if ((state.hostDisconnectedAt !== undefined && now >= state.hostDisconnectedAt + 300_000) || (state.storagePausedAt !== undefined && now >= state.storagePausedAt + 60000)) {
            room.dispatch({ type: "room.end", hostId: state.hostId });
            expiredRoomCodes.push(roomCode);
          }
          continue;
        }
        if ((state.lastActivityAt !== undefined && now >= state.lastActivityAt + 7_200_000) || (state.createdAt !== undefined && now >= state.createdAt + 7_200_000)) {
          room.dispatch({ type: "room.end", hostId: state.hostId });
          expiredRoomCodes.push(roomCode);
          continue;
        }
        if (state.phase !== "answering" || !state.round || state.round.endsAt > now) continue;
        room.dispatch({ type: "round.close", hostId: state.hostId });
        expiredRoomCodes.push(roomCode);
      }
      return expiredRoomCodes;
    }
  };
}
