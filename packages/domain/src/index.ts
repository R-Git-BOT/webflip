export type ScoreMode = "none" | "correct-count";

export type RoomSettings = {
  capacity: number;
  answerSeconds: number;
  scoreMode: ScoreMode;
};

export type Participant = {
  id: string;
  name: string;
  connected: boolean;
  correctCount: number;
  left?: boolean;
};

export type RoundState = {
  prompt: string;
  answerSeconds: number;
  startedAt: number;
  endsAt: number;
  targetParticipantIds: string[];
  revealNamesDuringJudging: boolean;
  answers: Answer[];
  locked: boolean;
  correctParticipantIds: string[];
};

export type DrawingData = {
  operations: unknown[];
};

export type Answer = {
  participantId: string;
  drawing: DrawingData;
  confirmed: boolean;
};

export type RoomState = {
  roomId: string;
  roomCode: string;
  hostId: string;
  phase: "waiting" | "answering" | "judging" | "results" | "ended";
  settings: RoomSettings;
  completedRounds: number;
  participants: Participant[];
  round: RoundState | null;
};

export type CreateRoomInput = RoomSettings & {
  roomId: string;
  roomCode: string;
  hostId: string;
};

export type RoomEngine = {
  getState(): RoomState;
  dispatch(command: RoomCommand): { ok: true };
};

export type JoinParticipantCommand = {
  type: "participant.join";
  participantId: string;
  name: string;
};

export type StartRoundCommand = {
  type: "round.start";
  hostId: string;
  prompt: string;
  answerSeconds: number;
  revealNamesDuringJudging: boolean;
  startedAt?: number;
};

export type ConfirmAnswerCommand = {
  type: "answer.confirm";
  participantId: string;
  drawing: DrawingData;
};

export type SaveDraftCommand = {
  type: "draft.save";
  participantId: string;
  drawing: DrawingData;
};

export type ReopenAnswerCommand = {
  type: "answer.reopen";
  participantId: string;
};

export type ToggleCorrectAnswerCommand = {
  type: "answer.toggleCorrect";
  hostId: string;
  participantId: string;
};

export type PublishResultsCommand = {
  type: "results.publish";
  hostId: string;
};

export type NextRoundCommand = {
  type: "round.next";
  hostId: string;
};

export type CloseRoundCommand = {
  type: "round.close";
  hostId: string;
};

export type EndRoomCommand = {
  type: "room.end";
  hostId: string;
};

export type ExitParticipantCommand = {
  type: "participant.exit";
  participantId: string;
};

export type RoomCommand =
  | JoinParticipantCommand
  | StartRoundCommand
  | SaveDraftCommand
  | ConfirmAnswerCommand
  | ReopenAnswerCommand
  | ToggleCorrectAnswerCommand
  | PublishResultsCommand
  | NextRoundCommand
  | CloseRoundCommand
  | EndRoomCommand
  | ExitParticipantCommand;

function requireHost(actualHostId: string, expectedHostId: string) {
  if (actualHostId !== expectedHostId) throw new Error("host_required");
}

function normalizedName(name: string) {
  return name.trim().toLocaleLowerCase();
}

function closeRound(state: RoomState) {
  if (state.phase !== "answering" || !state.round) throw new Error("round_not_answering");
  const answers = new Map(state.round.answers.map((answer) => [answer.participantId, answer]));
  state.round.answers = state.round.targetParticipantIds.map((participantId) => {
    const answer = answers.get(participantId);
    return answer
      ? { ...answer, confirmed: true }
      : { participantId, confirmed: true, drawing: { operations: [] } };
  });
  state.round.locked = true;
  state.phase = "judging";
}

export function createRoomEngine(input: CreateRoomInput, restoredState?: RoomState): RoomEngine {
  const state: RoomState = restoredState ? structuredClone(restoredState) : {
    roomId: input.roomId,
    roomCode: input.roomCode,
    hostId: input.hostId,
    phase: "waiting",
    settings: {
      capacity: input.capacity,
      answerSeconds: input.answerSeconds,
      scoreMode: input.scoreMode
    },
    completedRounds: 0,
    participants: [],
    round: null
  };

  return {
    getState: () => structuredClone(state),
    dispatch(command) {
      if (command.type === "participant.join") {
        if (state.phase === "ended") throw new Error("room_ended");
        const name = command.name.trim();
        if (name.length < 1 || Array.from(name).length > 20 || /[\n\r\t\u0000-\u001f\u007f]/u.test(name)) {
          throw new Error("invalid_name");
        }
        if (state.participants.filter((participant) => !participant.left).length >= state.settings.capacity) throw new Error("room_full");
        if (state.participants.some((participant) => !participant.left && normalizedName(participant.name) === normalizedName(name))) {
          throw new Error("name_taken");
        }
        state.participants.push({
          id: command.participantId,
          name,
          connected: true,
          correctCount: 0
        });
      }

      if (command.type === "participant.exit" && state.phase === "waiting") {
        state.participants = state.participants.filter(
          (participant) => participant.id !== command.participantId
        );
      }

      if (command.type === "participant.exit" && state.phase === "answering" && state.round) {
        state.participants = state.participants.filter(
          (participant) => participant.id !== command.participantId
        );
        state.round.targetParticipantIds = state.round.targetParticipantIds.filter(
          (participantId) => participantId !== command.participantId
        );
        state.round.answers = state.round.answers.filter(
          (answer) => answer.participantId !== command.participantId
        );
        if (state.round.targetParticipantIds.length === 0) {
          state.phase = "waiting";
          state.round = null;
        } else {
          const confirmedIds = new Set(
            state.round.answers.filter((answer) => answer.confirmed).map((answer) => answer.participantId)
          );
          if (state.round.targetParticipantIds.every((participantId) => confirmedIds.has(participantId))) {
            closeRound(state);
          }
        }
      }

      if (
        command.type === "participant.exit" &&
        (state.phase === "judging" || state.phase === "results")
      ) {
        const participant = state.participants.find(
          (candidate) => candidate.id === command.participantId
        );
        if (participant) {
          participant.connected = false;
          participant.left = true;
        }
      }

      if (command.type === "round.start") {
        requireHost(command.hostId, state.hostId);
        if (state.phase !== "waiting") throw new Error("room_not_waiting");
        const targets = state.participants.filter((participant) => participant.connected && !participant.left);
        if (targets.length === 0) throw new Error("participant_required");
        const prompt = command.prompt.trim();
        if (prompt.length < 1 || Array.from(prompt).length > 120) throw new Error("invalid_prompt");
        if (![30, 60, 90, 120, 180].includes(command.answerSeconds)) throw new Error("invalid_answer_seconds");
        const startedAt = command.startedAt ?? Date.now();
        state.phase = "answering";
        state.round = {
          prompt,
          answerSeconds: command.answerSeconds,
          startedAt,
          endsAt: startedAt + command.answerSeconds * 1_000,
          targetParticipantIds: targets.map((participant) => participant.id),
          revealNamesDuringJudging: command.revealNamesDuringJudging,
          answers: [],
          locked: false,
          correctParticipantIds: []
        };
      }

      if (command.type === "answer.confirm" && state.round) {
        if (state.phase !== "answering" || state.round.locked) throw new Error("round_locked");
        if (!state.round.targetParticipantIds.includes(command.participantId)) throw new Error("not_round_participant");
        const existingAnswer = state.round.answers.find(
          (answer) => answer.participantId === command.participantId
        );
        if (existingAnswer) {
          existingAnswer.drawing = command.drawing;
          existingAnswer.confirmed = true;
        } else {
          state.round.answers.push({
            participantId: command.participantId,
            drawing: command.drawing,
            confirmed: true
          });
        }

        const confirmedParticipantIds = new Set(
          state.round.answers
            .filter((answer) => answer.confirmed)
            .map((answer) => answer.participantId)
        );
        const everyoneConfirmed = state.round.targetParticipantIds.every((participantId) =>
          confirmedParticipantIds.has(participantId)
        );
        if (everyoneConfirmed) {
          state.phase = "judging";
          state.round.locked = true;
        }
      }

      if (command.type === "draft.save" && state.round && !state.round.locked) {
        if (state.phase !== "answering") throw new Error("round_not_answering");
        if (!state.round.targetParticipantIds.includes(command.participantId)) throw new Error("not_round_participant");
        const existingAnswer = state.round.answers.find(
          (answer) => answer.participantId === command.participantId
        );
        if (existingAnswer) {
          existingAnswer.drawing = command.drawing;
        } else {
          state.round.answers.push({
            participantId: command.participantId,
            drawing: command.drawing,
            confirmed: false
          });
        }
      }

      if (command.type === "answer.reopen" && state.round && !state.round.locked) {
        if (state.phase !== "answering") throw new Error("round_not_answering");
        const answer = state.round.answers.find(
          (candidate) => candidate.participantId === command.participantId
        );
        if (answer) answer.confirmed = false;
      }

      if (command.type === "answer.toggleCorrect" && state.round) {
        requireHost(command.hostId, state.hostId);
        if (state.phase !== "judging") throw new Error("room_not_judging");
        const correctParticipantIds = new Set(state.round.correctParticipantIds);
        if (correctParticipantIds.has(command.participantId)) {
          correctParticipantIds.delete(command.participantId);
        } else {
          correctParticipantIds.add(command.participantId);
        }
        state.round.correctParticipantIds = [...correctParticipantIds];
      }

      if (command.type === "results.publish" && state.round) {
        requireHost(command.hostId, state.hostId);
        if (state.phase !== "judging") throw new Error("room_not_judging");
        if (state.settings.scoreMode === "correct-count") {
          const correctParticipantIds = new Set(state.round.correctParticipantIds);
          for (const participant of state.participants) {
            if (correctParticipantIds.has(participant.id)) {
              participant.correctCount += 1;
            }
          }
        }
        state.completedRounds += 1;
        state.phase = "results";
      }

      if (command.type === "round.next") {
        requireHost(command.hostId, state.hostId);
        if (state.phase !== "results") throw new Error("room_not_results");
        state.phase = "waiting";
        state.round = null;
        state.participants = state.participants.filter((participant) => !participant.left);
      }

      if (command.type === "round.close") {
        requireHost(command.hostId, state.hostId);
        closeRound(state);
      }

      if (command.type === "room.end") {
        requireHost(command.hostId, state.hostId);
        state.phase = "ended";
        state.participants = [];
        state.round = null;
      }

      return { ok: true };
    }
  };
}
