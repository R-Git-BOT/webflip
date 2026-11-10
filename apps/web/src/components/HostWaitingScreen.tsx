import React from "react";
import {
  Clock,
  Copy,
  EyeSlash,
  LinkSimple,
  Medal,
  Play,
  Trash,
  UsersThree
} from "@phosphor-icons/react";
import { JoinQrCode } from "./JoinQrCode";

type Participant = {
  id: string;
  name: string;
  connected: boolean;
  correctCount: number;
};

type HostWaitingScreenProps = {
  roomCode: string;
  participants: Participant[];
  capacity: number;
  answerSeconds: number;
  scoreMode: "none" | "correct-count";
  onStart(): void;
  onEnd(): void;
};

const AVATAR_COLORS = ["#dd4b55", "#2056d7", "#d38a10", "#7046b5"];

function initialOf(name: string) {
  return Array.from(name.trim())[0] ?? "?";
}

async function copyText(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(value);
  }
}

export function HostWaitingScreen({
  roomCode,
  participants,
  capacity,
  answerSeconds,
  scoreMode,
  onStart,
  onEnd
}: HostWaitingScreenProps) {
  const joinUrl =
    typeof window === "undefined"
      ? `https://webflipper.app/room/${roomCode}`
      : `${window.location.origin}/?room=${roomCode}`;

  return (
    <main className="screen-shell">
      <div className="waiting-layout">
        <section className="room-hero" aria-labelledby="room-code-title">
          <div className="wordmark wordmark--inverse">WebFlipper</div>
          <div className="room-hero__rule" />
          <p className="room-hero__label" id="room-code-title">ルームコード</p>
          <div className="room-code">{roomCode}</div>
          <div className="room-share-actions">
            <button className="button button--light" type="button" onClick={() => void copyText(roomCode)}>
              <Copy aria-hidden="true" size={30} weight="regular" />
              コードをコピー
            </button>
            <button className="button button--light" type="button" onClick={() => void copyText(joinUrl)}>
              <LinkSimple aria-hidden="true" size={30} weight="regular" />
              参加リンクをコピー
            </button>
          </div>
          <div className="join-url" aria-label="参加URL">{joinUrl}</div>
          <JoinQrCode joinUrl={joinUrl} roomCode={roomCode} />
        </section>

        <section className="waiting-panel" aria-label="ルーム管理">
          <div className="connection-summary">
            <span className="status-dot" />
            {participants.filter((participant) => participant.connected).length}人が接続中
          </div>

          <section className="participant-section" aria-labelledby="participants-title">
            <header className="section-heading-row">
              <h1 id="participants-title">参加者</h1>
              <div className="participant-count">
                <strong>{participants.length}</strong> / {capacity}
              </div>
            </header>
            <div className="participant-list">
              {participants.map((participant, index) => (
                <div className="participant-row" key={participant.id}>
                  <span
                    className="avatar"
                    style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
                  >
                    {initialOf(participant.name)}
                  </span>
                  <span className="participant-name">{participant.name}</span>
                  <span
                    className={`status-dot ${participant.connected ? "" : "status-dot--offline"}`}
                    aria-label={participant.connected ? "接続中" : "切断中"}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section" aria-labelledby="settings-title">
            <h2 id="settings-title">ルームの設定</h2>
            <dl className="settings-list">
              <div className="setting-row">
                <dt><Clock aria-hidden="true" size={28} />回答時間</dt>
                <dd>{answerSeconds}秒</dd>
              </div>
              <div className="setting-row">
                <dt><UsersThree aria-hidden="true" size={28} />定員</dt>
                <dd>{capacity}人</dd>
              </div>
              <div className="setting-row">
                <dt><Medal aria-hidden="true" size={28} />成績</dt>
                <dd>{scoreMode === "correct-count" ? "正解回数" : "記録しない"}</dd>
              </div>
              <div className="setting-row">
                <dt><EyeSlash aria-hidden="true" size={28} />判定中の名前</dt>
                <dd>名前を隠す</dd>
              </div>
            </dl>
          </section>

          <button className="button button--primary start-button" type="button" onClick={onStart} disabled={!participants.some((participant) => participant.connected)}>
            <Play aria-hidden="true" size={32} weight="fill" />
            ラウンドを始める
          </button>
          <button className="danger-action" type="button" onClick={onEnd}>
            <Trash aria-hidden="true" size={24} />
            ルームを終了
          </button>
        </section>
      </div>
    </main>
  );
}
