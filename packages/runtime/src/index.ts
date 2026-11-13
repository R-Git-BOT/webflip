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

export type DiscordIdentity = { id: string; displayName: string; avatar: string | null };
export function discordAvatarUrl(identity: DiscordIdentity): string {
  return identity.avatar
    ? `https://cdn.discordapp.com/avatars/${identity.id}/${identity.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(identity.id) >> 22n) % 6n}.png`;
}
type Session =
  | { role: "host"; roomCode: string; hostId: string; discordId?: string }
  | { role: "participant"; roomCode: string; participantId: string; discordId?: string };

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
  }, discord?: DiscordIdentity): { roomCode: string; sessionId: string };
  joinRoom(input: { roomCode: string; name: string; previousSessionId?: string; discord?: DiscordIdentity }): { sessionId: string };
  leaveRoom(sessionId: string): { roomCode: string };
  getSnapshot(sessionId: string): RoomSnapshot;
  dispatch(sessionId: string, command: LocalCommand): { ok: true };
  expireDueRounds(now: number): string[];
};

export type PersistedRoomService = {
  blockedSessions?: Record<string, string>;
  blockedDiscord?: Record<string, string>;
  receipts?: Record<string, { sessionId: string; fingerprint: string }>;
  rooms: [string, RoomState][];
  sessions: [string, Session][];
};

export type LocalCommand =
  | { type: "host.activity" }
  | { type: "participants.removeDisconnected" }
  | { type: "participant.remove"; participantId: string }
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
  const blockedSessions = structuredClone(persisted?.blockedSessions ?? {});
  const blockedDiscord = structuredClone(persisted?.blockedDiscord ?? {});
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
      for (const [id, code] of Object.entries(blockedSessions)) if (!rooms.has(code) || rooms.get(code)!.getState().phase === "ended") delete blockedSessions[id];
      for (const [id, code] of Object.entries(blockedDiscord)) if (!rooms.has(code) || rooms.get(code)!.getState().phase === "ended") delete blockedDiscord[id];
      for (const session of sessions.values()) if (rooms.get(session.roomCode)?.getState().phase === "ended") delete session.discordId;
      return structuredClone({ rooms: [...rooms].map(([code, engine]) => [code, engine.getState()] as [string, RoomState]), sessions: [...sessions], receipts, blockedSessions, blockedDiscord });
    },
    createRoom(settings, discord) {
      const roomId = dependencies.nextId();
      const hostId = dependencies.nextId();
      const roomCode = dependencies.nextRoomCode();
      const sessionId = crypto.randomUUID();
      rooms.set(
        roomCode,
        createRoomEngine({ roomId, roomCode, hostId, ...settings })
      );
      sessions.set(sessionId, { role: "host", roomCode, hostId, ...(discord ? { discordId: discord.id } : {}) });
      return { roomCode, sessionId };
    },
    joinRoom(input) {
      if (input.previousSessionId && blockedSessions[input.previousSessionId] === input.roomCode) throw new Error("participant_excluded");
      const room = rooms.get(input.roomCode);
      if (!room) throw new Error("room_not_found");
      if (room.getState().phase === "ended") throw new Error("room_ended");
      if (input.discord) {
        if (blockedDiscord[`${input.roomCode}:${input.discord.id}`] === input.roomCode) throw new Error("participant_excluded");
        for (const [sessionId, session] of sessions) if (session.roomCode === input.roomCode && session.discordId === input.discord.id) return { sessionId };
      }
      const participantId = dependencies.nextId();
      const sessionId = crypto.randomUUID();
      room.dispatch({
        type: "participant.join",
        participantId,
        name: input.name,
        ...(input.discord ? { avatarUrl: discordAvatarUrl(input.discord) } : {})
      });
      sessions.set(sessionId, {
        role: "participant",
        roomCode: input.roomCode,
        participantId,
        ...(input.discord ? { discordId: input.discord.id } : {})
      });
      return { sessionId };
    },
    leaveRoom(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error("session_not_found");
      const room = rooms.get(session.roomCode);
      if (!room) throw new Error("room_not_found");
      if (room.getState().phase === "ended") {
        sessions.delete(sessionId);
        return { roomCode: session.roomCode };
      }
      if (session.role !== "participant") throw new Error("participant_required");
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

      if (command.type === "host.activity") {
        if (session.role !== "host") throw new Error("host_required");
        return room.dispatch({ type: "host.activity", hostId: session.hostId });
      }
      if (session.role === "host") room.dispatch({ type: "host.activity", hostId: session.hostId });

      if (command.type === "participants.removeDisconnected") {
        if (session.role !== "host") throw new Error("host_required");
        const state = room.getState();
        const confirmed = new Set(state.round?.answers.filter(answer => answer.confirmed).map(answer => answer.participantId));
        // Keep pending targets until last so reception cannot close halfway through the batch.
        const targets = state.participants.filter(p => !p.connected && !p.left).map(p => p.id)
          .sort((a, b) => Number(confirmed.has(b)) - Number(confirmed.has(a)));
        for (const participantId of targets) this.dispatch(sessionId, { type: "participant.remove", participantId });
        return { ok: true };
      }

      if (command.type === "participant.remove") {
        if (session.role !== "host") throw new Error("host_required");
        if (!room.getState().participants.some(p => p.id === command.participantId && !p.left)) throw new Error("participant_not_found");
        const result = room.dispatch({ type: "participant.exit", participantId: command.participantId });
        for (const [id, target] of sessions) if (target.role === "participant" && target.roomCode === session.roomCode && target.participantId === command.participantId) {
          blockedSessions[id] = session.roomCode;
          if (target.discordId) blockedDiscord[`${session.roomCode}:${target.discordId}`] = session.roomCode;
          sessions.delete(id);
        }
        return result;
      }

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
        if (now >= (state.lastHostActivityAt ?? state.createdAt ?? now) + 600_000 || (state.createdAt !== undefined && now >= state.createdAt + 7_200_000)) {
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
