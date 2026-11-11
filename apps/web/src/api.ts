import type { RoomState } from "@webflipper/domain";
const connectionId = typeof window === "undefined" ? "server" : crypto.randomUUID();

export type Snapshot = {
  role: "host" | "participant";
  participantId?: string;
  room: RoomState;
};

export class StaleRoundError extends Error {
  constructor(readonly snapshot: Snapshot | null) { super("stale_round"); }
}

export type ClientCommand =
  | { type: "participants.removeDisconnected" }
  | { type: "participant.remove"; participantId: string }
  | { type: "round.start"; prompt: string; answerSeconds: number; revealNamesDuringJudging: boolean; startedAt?: number }
  | { type: "draft.save"; drawing: { operations: unknown[] } }
  | { type: "answer.confirm"; drawing: { operations: unknown[] } }
  | { type: "answer.reopen" }
  | { type: "answer.toggleCorrect"; participantId: string }
  | { type: "results.publish" }
  | { type: "round.next" }
  | { type: "round.close" }
  | { type: "room.end" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-wf-connection": connectionId,
      ...init?.headers
    }
  });
  const value = (await response.json()) as T & { error?: string };
  if (response.status === 403 && value.error === "trial_required") window.location.assign(`/trial?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  if (!response.ok) throw new Error(value.error ?? "request_failed");
  return value;
}

export const api = {
  hostActivity() {
    return request<{ snapshot: Snapshot }>("/api/command", { method: "POST", body: JSON.stringify({ type: "host.activity" }) });
  },
  async getSession() {
    return request<{ snapshot: Snapshot | null }>("/api/session");
  },
  async createRoom(input: { capacity: number; answerSeconds: number; scoreMode: "none" | "correct-count" }) {
    return request<{ roomCode: string; snapshot: Snapshot }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  async joinRoom(input: { roomCode: string; name: string }) {
    return request<{ snapshot: Snapshot }>(`/api/rooms/${input.roomCode}/join`, {
      method: "POST",
      body: JSON.stringify({ name: input.name })
    });
  },
  async leaveRoom() {
    return request<{ snapshot: null }>("/api/leave", { method: "POST", body: "{}" });
  },
  async command(command: ClientCommand, roundToken: number | null = null) {
    try { return await request<{ snapshot: Snapshot }>("/api/command", {
      method: "POST",
      body: JSON.stringify({ ...command, commandId: crypto.randomUUID(), roundToken })
    }); } catch (error) {
      if (error instanceof Error && error.message === "stale_round") {
        const { snapshot } = await api.getSession();
        throw new StaleRoundError(snapshot);
      }
      throw error;
    }
  }
};

export function subscribeToRoom(
  onSnapshot: (snapshot: Snapshot) => void,
  onSessionLost: () => void,
  onConnectionChange: (connected: boolean) => void = () => undefined
) {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer: number | null = null;
  let retryDelay = 500;

  function connect() {
    if (stopped) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/ws?connection=${connectionId}`);
    socket.addEventListener("open", () => { if (stopped) return; retryDelay = 500; onConnectionChange(true); });
    socket.addEventListener("message", (event) => {
      if (stopped) return;
      const message = JSON.parse(String(event.data)) as { type: string; snapshot?: Snapshot };
      if (message.type === "snapshot" && message.snapshot) onSnapshot(message.snapshot);
    });
    socket.addEventListener("close", (event) => {
      if (stopped) return;
      onConnectionChange(false);
      if (event.code === 4001 || event.code === 4008) {
        stopped = true;
        onSessionLost();
        return;
      }
      retryTimer = window.setTimeout(async () => {
        try {
          const session = await api.getSession();
          if (!session.snapshot) {
            onSessionLost();
            return;
          }
          onSnapshot(session.snapshot);
        } catch {
          // The local server may still be restarting. The socket retry remains authoritative.
        }
        retryDelay = Math.min(retryDelay * 2, 60_000);
        connect();
      }, retryDelay);
    });
  }

  connect();
  return () => {
    stopped = true;
    onConnectionChange(false);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    socket?.close();
  };
}
