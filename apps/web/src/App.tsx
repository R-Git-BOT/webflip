import React, { useEffect, useState } from "react";
import { Check, Play, SignOut, X } from "@phosphor-icons/react";
import type { DrawingOperation } from "@webflipper/canvas";
import { ROOM_CAPACITIES, type Participant, type RoomState } from "@webflipper/domain";
import { api, StaleRoundError, subscribeToRoom, type ClientCommand, type Snapshot } from "./api";
import { DrawingBoard } from "./components/DrawingBoard";
import { HostWaitingScreen } from "./components/HostWaitingScreen";
import { useRoomSound } from "./useRoomSound";

type HomeScreenProps = {
  busy: boolean;
  error: string | null;
  notice?: string | null;
  initialRoomCode: string;
  joinOnly?: boolean;
  onCreate(input: { capacity: number; answerSeconds: number; scoreMode: "none" | "correct-count" }): void;
  onJoin(input: { roomCode: string; name: string }): void;
};

export function HomeScreen({ busy, error, notice = null, initialRoomCode, joinOnly = false, onCreate, onJoin }: HomeScreenProps) {
  const [capacity, setCapacity] = useState(10);
  const [answerSeconds, setAnswerSeconds] = useState(60);
  const [scoreMode, setScoreMode] = useState<"none" | "correct-count">("none");
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [name, setName] = useState("");

  return (
    <main className={`home-shell ${joinOnly ? "home-shell--join-only" : ""}`}>
      <section className="home-hero">
        <div className="wordmark wordmark--inverse">WebFlipper</div>
        <div className="home-hero__content">
          {joinOnly ? (
            <>
              <p className="home-hero__eyebrow">ルームコード</p>
              <strong className="home-hero__room-code">{initialRoomCode}</strong>
              <h1>このルームに参加</h1>
            </>
          ) : (
            <>
              <h1>手書きクイズ</h1>
              <p>ホストがお題を出し、参加者はブラウザ上のCanvasに回答します。</p>
            </>
          )}
        </div>
      </section>
      <section className="home-actions" aria-label="開始方法">
        {!joinOnly ? <div className="home-action-block">
          <h2>ルームを作る</h2>
          <form onSubmit={(event) => { event.preventDefault(); onCreate({ capacity, answerSeconds, scoreMode }); }}>
            <label>定員
              <select value={capacity} onChange={(event) => setCapacity(Number(event.target.value))}>
                {ROOM_CAPACITIES.map((value) => <option key={value} value={value}>{value}人</option>)}
              </select>
            </label>
            <label>回答時間
              <select value={answerSeconds} onChange={(event) => setAnswerSeconds(Number(event.target.value))}>
                {[30, 60, 90, 120, 180].map((value) => <option key={value} value={value}>{value}秒</option>)}
              </select>
            </label>
            <label>成績
              <select value={scoreMode} onChange={(event) => setScoreMode(event.target.value as typeof scoreMode)}>
                <option value="none">記録しない</option>
                <option value="correct-count">正解回数</option>
              </select>
            </label>
            <button className="button button--primary" type="submit" disabled={busy}>ルームを作る</button>
          </form>
        </div> : null}

        <div className={`home-action-block home-action-block--join ${joinOnly ? "home-action-block--direct" : ""}`}>
          <h2>{joinOnly ? "名前を入力" : "ルームに参加"}</h2>
          <form onSubmit={(event) => { event.preventDefault(); onJoin({ roomCode: roomCode.trim().toUpperCase(), name: name.trim() }); }}>
            {!joinOnly ? <label>ルームコード
              <input
                value={roomCode}
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="6文字"
                onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              />
            </label> : null}
            <label>ルーム内の名前
              <input value={name} maxLength={20} autoComplete="nickname" onChange={(event) => setName(event.target.value)} />
            </label>
            <button className="button button--primary" type="submit" disabled={busy || roomCode.length !== 6 || name.trim().length === 0}>ルームに参加</button>
          </form>
          {joinOnly ? <a className="back-link" href="/">トップへ戻る</a> : null}
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </section>
    </main>
  );
}

type RoundDialogProps = {
  defaultSeconds: number;
  onClose(): void;
  onStart(input: { prompt: string; answerSeconds: number; revealNamesDuringJudging: boolean }): void;
};

function RoundDialog({ defaultSeconds, onClose, onStart }: RoundDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [answerSeconds, setAnswerSeconds] = useState(defaultSeconds);
  const [revealNames, setRevealNames] = useState(false);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="round-dialog-title">
        <button className="icon-button modal__close" type="button" onClick={onClose} aria-label="閉じる"><X size={24} /></button>
        <h2 id="round-dialog-title">ラウンドを始める</h2>
        <form onSubmit={(event) => { event.preventDefault(); onStart({ prompt: prompt.trim(), answerSeconds, revealNamesDuringJudging: revealNames }); }}>
          <label>お題
            <textarea value={prompt} maxLength={120} rows={3} autoFocus onChange={(event) => setPrompt(event.target.value)} />
          </label>
          <label>回答時間
            <select value={answerSeconds} onChange={(event) => setAnswerSeconds(Number(event.target.value))}>
              {[30, 60, 90, 120, 180].map((value) => <option key={value} value={value}>{value}秒</option>)}
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={revealNames} onChange={(event) => setRevealNames(event.target.checked)} />
            判定中に回答者名を表示する
          </label>
          <button className="button button--primary" type="submit" disabled={prompt.trim().length === 0}>
            <Play size={25} weight="fill" />回答受付を始める
          </button>
        </form>
      </section>
    </div>
  );
}

function AppHeader({ roomCode, status, onLeave }: { roomCode: string; status?: string; onLeave?: () => void }) {
  return (
    <header className="app-header">
      <div className="wordmark">WebFlipper</div>
      <div className="app-header__room"><span>ルームコード</span><strong>{roomCode}</strong></div>
      {status ? <div className="app-header__status"><span className="status-dot" />{status}</div> : null}
      {onLeave ? <button className="header-leave" type="button" onClick={onLeave}><SignOut size={21} />ルームを退出</button> : null}
    </header>
  );
}

function TimeRemaining({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  return <strong className="time-remaining" aria-label="残り時間">{Math.max(0, Math.ceil((endsAt - now) / 1_000))}秒</strong>;
}

function ParticipantWaitingScreen({ room, participantId, onLeave }: { room: RoomState; participantId: string; onLeave(): void }) {
  const me = room.participants.find((participant) => participant.id === participantId);
  return (
    <main className="flow-screen">
      <AppHeader roomCode={room.roomCode} status={`${room.participants.filter((item) => item.connected && !item.left).length}人が接続中`} onLeave={onLeave} />
      <div className="flow-two-column">
        <section className="dark-message">
          <span className="avatar avatar--large">{Array.from(me?.name ?? "?")[0]}</span>
          <h1>{me?.name}</h1>
          <p>参加しました</p>
        </section>
        <section className="light-section">
          <h2>参加者</h2>
          <ParticipantList participants={room.participants.filter((participant) => !participant.left)} scoreMode={room.settings.scoreMode} />
          <p className="waiting-message">ホストがラウンドを開始するまでお待ちください。</p>
        </section>
      </div>
    </main>
  );
}

function ParticipantList({ participants, scoreMode }: { participants: Participant[]; scoreMode: "none" | "correct-count" }) {
  return (
    <div className="compact-participant-list">
      {participants.map((participant) => (
        <div key={participant.id} className="compact-participant-row">
          <span className={`status-dot ${participant.connected ? "" : "status-dot--offline"}`} />
          <span>{participant.name}</span>
          {scoreMode === "correct-count" ? <span>{participant.correctCount}回</span> : null}
        </div>
      ))}
    </div>
  );
}

function HostAnsweringScreen({ room, onClose }: { room: RoomState; onClose(): void }) {
  const confirmedIds = new Set(room.round?.answers.filter((answer) => answer.confirmed).map((answer) => answer.participantId));
  const targets = room.participants.filter((participant) => room.round?.targetParticipantIds.includes(participant.id));
  return (
    <main className="flow-screen flow-screen--game">
      <AppHeader roomCode={room.roomCode} status="回答受付中" />
      <section className="host-progress">
        <div className="prompt-block"><span>お題</span><h1>{room.round?.prompt}</h1></div>
        <div className="progress-count"><strong>{confirmedIds.size}</strong><span> / {targets.length}人が確定</span><TimeRemaining endsAt={room.round?.endsAt ?? Date.now()} /></div>
        <div className="confirmation-list">
          {targets.map((participant) => (
            <div key={participant.id} className="confirmation-row">
              {confirmedIds.has(participant.id) ? <Check size={24} weight="bold" /> : <span className="pending-ring" />}
              <span>{participant.name}</span>
              <span>{confirmedIds.has(participant.id) ? "確定済み" : "回答中"}</span>
            </div>
          ))}
        </div>
        <button className="button button--secondary close-reception" type="button" onClick={onClose}>回答受付を終了</button>
      </section>
    </main>
  );
}

function ParticipantAnsweringScreen({ snapshot, send, onLeave, connected }: { snapshot: Snapshot; send(command: ClientCommand): void; onLeave(): void; connected: boolean }) {
  const round = snapshot.room.round;
  const answer = round?.answers.find((candidate) => candidate.participantId === snapshot.participantId);
  if (!round?.targetParticipantIds.includes(snapshot.participantId ?? "")) return <main className="loading-screen"><AppHeader roomCode={snapshot.room.roomCode} status="次のラウンドを待っています" onLeave={onLeave} /><h1>次のラウンドから回答できます</h1></main>;
  return (
    <main className="flow-screen flow-screen--game">
      <AppHeader roomCode={snapshot.room.roomCode} status="回答受付中" onLeave={onLeave} />
      <section className="answer-layout">
        <header className="prompt-block prompt-block--horizontal"><span>お題</span><h1>{round?.prompt}</h1><TimeRemaining endsAt={round?.endsAt ?? Date.now()} /></header>
        <DrawingBoard
          key={round?.startedAt}
          confirmed={answer?.confirmed ?? false}
          disabled={!connected}
          initialOperations={(answer?.drawing.operations ?? []) as DrawingOperation[]}
          initialRedoOperations={(answer?.drawing.redoOperations ?? []) as DrawingOperation[]}
          onDraftChange={(drawing) => send({ type: "draft.save", drawing })}
          onConfirm={(drawing) => send({ type: "answer.confirm", drawing })}
          onReopen={() => send({ type: "answer.reopen" })}
        />
      </section>
    </main>
  );
}

function CanvasPreview({ operations, correct, pngDataUrl }: { operations: DrawingOperation[]; correct: boolean; pngDataUrl?: string | undefined }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.fillStyle = correct ? "#cf2835" : "#0868d9";
    context.fillRect(0, 0, 1024, 768);
    if (pngDataUrl) {
      let cancelled = false;
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        context.drawImage(image, 0, 0, 1024, 768);
        if (correct) {
          const pixels = context.getImageData(0, 0, 1024, 768);
          for (let i = 0; i < pixels.data.length; i += 4) {
            const ink = Math.max(0, Math.min(1, (pixels.data[i]! - 8) / 247));
            pixels.data[i] = Math.round(207 + 48 * ink);
            pixels.data[i + 1] = Math.round(40 + 215 * ink);
            pixels.data[i + 2] = Math.round(53 + 202 * ink);
          }
          context.putImageData(pixels, 0, 0);
        }
      };
      image.src = pngDataUrl;
      return () => { cancelled = true; };
    }
    context.strokeStyle = "#ffffff";
    context.lineWidth = 8;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const operation of operations) {
      if (operation.kind === "clear") context.fillRect(0, 0, 1024, 768);
      else if (operation.points.length > 0) {
        context.beginPath();
        context.moveTo(operation.points[0]?.[0] ?? 0, operation.points[0]?.[1] ?? 0);
        for (const point of operation.points.slice(1)) context.lineTo(point[0], point[1]);
        context.stroke();
      }
    }
  }, [correct, operations, pngDataUrl]);
  return (
    <canvas
      className="answer-preview"
      ref={ref}
      width={1024}
      height={768}
      aria-label={`${correct ? "赤い" : "青い"}フリップ上の手書き回答`}
    />
  );
}

export function getAnswerGridDimensions(answerCount: number) {
  if (answerCount <= 1) return { columns: 1, rows: 1 };
  if (answerCount <= 4) return { columns: 2, rows: Math.ceil(answerCount / 2) };
  if (answerCount <= 6) return { columns: 3, rows: 2 };
  if (answerCount <= 8) return { columns: 4, rows: 2 };
  if (answerCount <= 9) return { columns: 3, rows: 3 };
  if (answerCount <= 12) return { columns: 4, rows: 3 };
  const columns = answerCount <= 15 ? 5 : Math.ceil(Math.sqrt(answerCount * 2));
  return { columns, rows: Math.ceil(answerCount / columns) };
}

export function AnswerGrid({ room, judging, onToggle }: { room: RoomState; judging: boolean; onToggle?(participantId: string): void }) {
  const participantMap = new Map(room.participants.map((participant) => [participant.id, participant]));
  const correctIds = new Set(room.round?.correctParticipantIds ?? []);
  const answers = room.round?.answers ?? [];
  const dimensions = getAnswerGridDimensions(answers.length);
  const mobileColumns = Math.min(answers.length || 1, answers.length > 15 ? 5 : answers.length > 6 ? 3 : 2);
  const mobileRows = Math.ceil((answers.length || 1) / mobileColumns);
  return (
    <div
      className={`answer-grid ${answers.length > 8 ? "answer-grid--dense" : ""} ${answers.length > 15 ? "answer-grid--crowded" : ""}`}
      style={{
        "--answer-columns": dimensions.columns,
        "--answer-rows": dimensions.rows,
        "--answer-mobile-columns": mobileColumns,
        "--answer-mobile-rows": mobileRows
      } as React.CSSProperties}
    >
      {answers.map((answer, index) => {
        const correct = correctIds.has(answer.participantId);
        const name = participantMap.get(answer.participantId)?.name ?? "退出した参加者";
        const visibleName = judging && !room.round?.revealNamesDuringJudging ? `回答 ${index + 1}` : name;
        const resultLabel = judging
          ? `${visibleName}、${correct ? "正解として選択中" : "未選択"}`
          : `${name}の回答、${correct ? "正解" : "不正解"}`;
        return (
          <button
            key={answer.participantId}
            type="button"
            className={`answer-card ${correct ? (judging ? "answer-card--selected" : "answer-card--correct") : "answer-card--incorrect"}`}
            disabled={!judging}
            onClick={() => onToggle?.(answer.participantId)}
            aria-pressed={judging ? correct : undefined}
            aria-label={resultLabel}
          >
            <div className="answer-card__surface">
              <CanvasPreview operations={answer.drawing.operations as DrawingOperation[]} correct={correct} pngDataUrl={answer.drawing.pngDataUrl} />
            </div>
            <span className="answer-card__name">{visibleName}</span>
          </button>
        );
      })}
    </div>
  );
}

function JudgingScreen({ snapshot, send, onLeave, busy }: { snapshot: Snapshot; send(command: ClientCommand): void; onLeave(): void; busy: boolean }) {
  if (snapshot.role === "participant") {
    const ownAnswer = snapshot.room.round?.answers.find((answer) => answer.participantId === snapshot.participantId);
    return (
      <main className="flow-screen flow-screen--game">
        <AppHeader roomCode={snapshot.room.roomCode} status="正解選択中" onLeave={onLeave} />
        <section className="participant-judging">
          <h1>ホストが正解を選んでいます</h1>
          {ownAnswer ? <div className="participant-judging__surface"><CanvasPreview operations={ownAnswer.drawing.operations as DrawingOperation[]} correct={false} /></div> : null}
        </section>
      </main>
    );
  }
  return (
    <main className="flow-screen flow-screen--game">
      <AppHeader roomCode={snapshot.room.roomCode} status="正解選択中" />
      <section className="judging-layout">
        <div><h1>正解を選ぶ</h1><p>正解は0個でも複数でも選べます。</p></div>
        <AnswerGrid room={snapshot.room} judging onToggle={(participantId) => send({ type: "answer.toggleCorrect", participantId })} />
        <button className="button button--primary publish-button" type="button" disabled={busy} onClick={() => send({ type: "results.publish" })}>結果を公開</button>
      </section>
    </main>
  );
}

function ResultsScreen({ snapshot, send, onLeave, onOpenRound }: { snapshot: Snapshot; send(command: ClientCommand): void; onLeave(): void; onOpenRound(): void }) {
  return (
    <main className="flow-screen flow-screen--game">
      <AppHeader roomCode={snapshot.room.roomCode} status="結果" {...(snapshot.role === "participant" ? { onLeave } : {})} />
      <section className="results-layout">
        <header><span>お題</span><h1>{snapshot.room.round?.prompt}</h1></header>
        <AnswerGrid room={snapshot.room} judging={false} />
        {snapshot.role === "host" ? <div className="results-actions"><button className="button button--secondary" onClick={() => send({ type: "round.next" })}>ロビーへ戻る</button><button className="button button--primary next-button" onClick={onOpenRound}>次の問題へ</button></div> : null}
      </section>
    </main>
  );
}

function ScreenRouter({ snapshot, send, onOpenRound, onLeave, onReturnToStart, connected, busy }: { snapshot: Snapshot; send(command: ClientCommand): void; onOpenRound(): void; onLeave(): void; onReturnToStart(): void; connected: boolean; busy: boolean }) {
  const { room } = snapshot;
  if (room.phase !== "ended" && room.storagePausedAt !== undefined) return <main className="loading-screen"><h1>保存機能の復旧を待っています</h1><p>進行と描画を一時停止しています。</p></main>;
  if (room.phase !== "ended" && room.hostDisconnectedAt !== undefined) {
    return <main className="loading-screen"><h1>ホストの復帰を待っています</h1><p>進行と描画を一時停止しています。</p></main>;
  }
  if (room.phase === "waiting") {
    if (snapshot.role === "host") {
      return (
        <HostWaitingScreen
          roomCode={room.roomCode}
          participants={room.participants}
          capacity={room.settings.capacity}
          onRemove={participantId => {
            const name = room.participants.find(p => p.id === participantId)?.name ?? "参加者";
            if (window.confirm(`${name}をルームから除外しますか？`)) send({ type: "participant.remove", participantId });
          }}
          onRemoveDisconnected={() => {
            if (window.confirm("現在切断している参加者を全員除外しますか？")) send({ type: "participants.removeDisconnected" });
          }}
          answerSeconds={room.settings.answerSeconds}
          scoreMode={room.settings.scoreMode}
          onStart={onOpenRound}
          onEnd={() => {
            if (window.confirm("お題・回答・参加者情報は削除され、元に戻せません。ルームを終了しますか？")) {
              send({ type: "room.end" });
            }
          }}
        />
      );
    }
    return <ParticipantWaitingScreen room={room} participantId={snapshot.participantId ?? ""} onLeave={onLeave} />;
  }
  if (room.phase === "ended") {
    return <main className="loading-screen"><div className="wordmark">WebFlipper</div><h1>ルームは終了しました</h1><button className="button button--primary" type="button" disabled={busy} onClick={onReturnToStart}>{snapshot.role === "host" ? "新しいルームを作る" : "トップへ戻る"}</button></main>;
  }
  if (room.phase === "answering") return snapshot.role === "host" ? <HostAnsweringScreen room={room} onClose={() => {
    if (window.confirm("未確定のCanvasも現在の内容で提出します。回答受付を終了しますか？")) send({ type: "round.close" });
  }} /> : <ParticipantAnsweringScreen snapshot={snapshot} send={send} onLeave={onLeave} connected={connected} />;
  if (room.phase === "judging") return <JudgingScreen snapshot={snapshot} send={send} onLeave={onLeave} busy={busy} />;
  return <ResultsScreen snapshot={snapshot} send={send} onLeave={onLeave} onOpenRound={onOpenRound} />;
}

function GameRoster({ snapshot, send }: { snapshot: Snapshot; send(command: ClientCommand): void }) {
  return <aside className="game-roster" aria-label="参加者の接続状況"><h2>参加者</h2><div className="game-roster__list">{snapshot.room.participants.filter(p => !p.left).map(p => <div key={p.id} className="game-roster__row"><span>{p.name}</span><small>{p.connected ? "接続中" : "切断中"}</small>{snapshot.role === "host" && !p.connected ? <button onClick={() => { if (window.confirm(`${p.name}を除外しますか？`)) send({ type: "participant.remove", participantId: p.id }); }}>除外</button> : null}</div>)}</div></aside>;
}

function messageFor(error: unknown) {
  const key = error instanceof Error ? error.message : "unknown_error";
  const messages: Record<string, string> = {
    room_not_found: "ルームが見つかりません。コードを確認してください。",
    session_not_found: "セッションが見つかりません。もう一度参加してください。",
    participant_excluded: "このルームから除外されたため、再参加できません。",
    rate_limited: "操作が続いています。1分ほど待ってからお試しください。",
    daily_limit: "本日の試用上限に達しました。時間をおいてご利用ください。",
    trial_room_busy: "現在ほかのルームで試用中です。ルームの終了後にお試しください。",
    trial_unavailable: "ただいま試用を停止しています。",
    storage_unavailable: "保存機能に接続できません。復旧をお待ちください。",
    storage_daily_limit: "本日の保存上限に達しました。時間をおいてご利用ください。",
    connection_required: "接続を確認しています。少し待ってからお試しください。",
    stale_round: "最新のラウンド情報へ更新しました。内容を確認して操作し直してください。",
    invalid_png: "回答画像を保存できませんでした。描画量を減らしてお試しください。",
    invalid_command: "操作形式を確認できませんでした。ページを再読み込みしてください。",
    invalid_drawing: "描画データを保存できませんでした。ページを再読み込みしてください。",
    room_not_judging: "結果はすでに公開済みか、判定画面が更新されています。",
    request_too_large: "回答データが大きすぎます。描画量を減らしてください。"
  };
  return messages[key] ?? `操作を完了できませんでした。もう一度お試しください。${/^[a-z_]{1,60}$/.test(key) ? `（${key}）` : ""}`;
}

export function selectInitialSnapshot<T extends { room: { roomCode: string } }>(
  snapshot: T | null,
  inviteRoomCode: string
) {
  if (snapshot && inviteRoomCode && snapshot.room.roomCode !== inviteRoomCode) return null;
  return snapshot;
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const sound = useRoomSound(snapshot);
  const [loading, setLoading] = useState(() => typeof window !== "undefined");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roundDialogOpen, setRoundDialogOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  function acceptSnapshot(value: Snapshot) {
    setSnapshot(current => current && current.room.roomCode === value.room.roomCode && (current.room.revision ?? 0) > (value.room.revision ?? 0) ? current : value);
  }
  const initialRoomCode = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";

  useEffect(() => {
    api.getSession()
      .then(({ snapshot: value }) => setSnapshot(selectInitialSnapshot(value, initialRoomCode)))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    return subscribeToRoom(acceptSnapshot, () => setSnapshot(null), setConnected);
  }, [snapshot?.room.roomCode]);

  async function run(action: () => Promise<{ snapshot: Snapshot }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      acceptSnapshot(result.snapshot);
    } catch (caught) {
      if (caught instanceof StaleRoundError) {
        if (caught.snapshot) acceptSnapshot(caught.snapshot);
        else setSnapshot(null);
      }
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  function send(command: ClientCommand) {
    void run(() => api.command(command, snapshot?.room.round?.startedAt ?? null));
  }

  async function leaveRoom() {
    if (!window.confirm("このルームから退出しますか？")) return;
    setBusy(true);
    setError(null);
    try {
      await api.leaveRoom();
      setSnapshot(null);
      setNotice("ルームから退出しました");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function returnToStart() {
    setBusy(true);
    setError(null);
    try {
      await api.leaveRoom();
      window.location.assign("/");
    } catch (caught) {
      setError(messageFor(caught));
    } finally { setBusy(false); }
  }

  if (loading) return <main className="loading-screen"><div className="wordmark">WebFlipper</div><p>読み込んでいます</p></main>;
  if (!snapshot) {
    return (
      <HomeScreen
        busy={busy}
        error={error}
        notice={notice}
        initialRoomCode={initialRoomCode}
        joinOnly={initialRoomCode.length === 6}
        onCreate={(input) => void run(() => api.createRoom(input))}
        onJoin={(input) => void run(() => api.joinRoom(input))}
      />
    );
  }

  return (
    <>
      <button className="sound-toggle" type="button" aria-label={sound.enabled ? "音をオフにする" : "音をオンにする"} aria-pressed={sound.enabled} onClick={sound.toggle}>{sound.enabled ? "音 ON" : "音 OFF"}</button>
      <div className={snapshot.room.phase !== "waiting" && snapshot.room.phase !== "ended" ? "game-shell" : ""}>
      {snapshot.room.phase !== "waiting" && snapshot.room.phase !== "ended" ? <GameRoster snapshot={snapshot} send={send} /> : null}
      <ScreenRouter snapshot={snapshot} send={send} onOpenRound={() => setRoundDialogOpen(true)} onLeave={() => void leaveRoom()} onReturnToStart={() => void returnToStart()} connected={connected} busy={busy} />
      </div>
      {roundDialogOpen ? (
        <RoundDialog
          defaultSeconds={snapshot.room.settings.answerSeconds}
          onClose={() => setRoundDialogOpen(false)}
          onStart={(input) => { setRoundDialogOpen(false); send({ type: "round.start", ...input }); }}
        />
      ) : null}
      {error ? <div className="global-error" role="alert">{error}</div> : null}
    </>
  );
}
