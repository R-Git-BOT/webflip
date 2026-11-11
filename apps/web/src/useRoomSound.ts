import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./api";

type SoundName = "AnswersDisplay" | "EndThinkTime" | "JoinUser" | "QuizStart" | "ThinkTimeBGM" | "Copy";
const names: SoundName[] = ["AnswersDisplay", "EndThinkTime", "JoinUser", "QuizStart", "ThinkTimeBGM", "Copy"];

export function useRoomSound(snapshot: Snapshot | null) {
  const [enabled, setEnabled] = useState(false);
  const audio = useRef<{ context: AudioContext; master: GainNode; buffers: Partial<Record<SoundName, AudioBuffer>>; bgm?: AudioBufferSourceNode } | null>(null);
  const previous = useRef<Snapshot | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const enabledRef = useRef(enabled);
  const loading = useRef<Partial<Record<SoundName, Promise<void>>>>({});
  enabledRef.current = enabled;

  function play(name: SoundName, loop = false) {
    const state = audio.current;
    const buffer = state?.buffers[name];
    if (!state || !buffer || !enabledRef.current || state.context.state !== "running") return;
    const source = state.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = state.context.createGain();
    gain.gain.value = loop ? 0.22 : 0.45;
    source.connect(gain).connect(state.master);
    source.start();
    if (loop) state.bgm = source;
  }

  function stopBgm() {
    const state = audio.current;
    if (state?.bgm) { state.bgm.stop(); delete state.bgm; }
  }

  useEffect(() => {
    function unlock() {
      if (!audio.current) {
        const context = new AudioContext();
        const master = context.createGain();
        master.gain.value = enabledRef.current ? 1 : 0;
        master.connect(context.destination);
        const state = { context, master, buffers: {} as Partial<Record<SoundName, AudioBuffer>> };
        audio.current = state;
        for (const name of names) {
          loading.current[name] = fetch(`/sounds/${name}.mp3`).then(response => {
            if (!response.ok) throw new Error("sound_unavailable");
            return response.arrayBuffer();
          }).then(data => context.decodeAudioData(data)).then(buffer => {
            state.buffers[name] = buffer;
            const room = latest.current?.room;
            if (name === "ThinkTimeBGM" && room?.phase === "answering" && room.hostDisconnectedAt === undefined && room.storagePausedAt === undefined && !audio.current?.bgm) play(name, true);
          }).catch(() => undefined);
        }
      }
      void audio.current.context.resume().then(() => {
        const room = latest.current?.room;
        if (room?.phase === "answering" && room.hostDisconnectedAt === undefined && room.storagePausedAt === undefined && !audio.current?.bgm) play("ThinkTimeBGM", true);
      }).catch(() => undefined);
    }
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); stopBgm(); void audio.current?.context.close(); audio.current = null; };
  }, []);

  useEffect(() => {
    const old = previous.current;
    previous.current = snapshot;
    const room = snapshot?.room;
    if (audio.current) audio.current.master.gain.value = enabled ? 1 : 0;
    const sameRoom = old && room && old.room.roomCode === room.roomCode;
    if (sameRoom) {
      const oldIds = new Set(old.room.participants.map(participant => participant.id));
      if (room.participants.some(participant => !participant.left && !oldIds.has(participant.id))) play("JoinUser");
      if (room.phase === "answering" && (old.room.phase !== "answering" || old.room.round?.startedAt !== room.round?.startedAt)) play("QuizStart");
      if (old.room.phase === "answering" && room.phase === "judging") play("EndThinkTime");
      if (old.room.phase === "judging" && room.phase === "results") play("AnswersDisplay");
    }
    const shouldPlay = enabled && room?.phase === "answering" && room.hostDisconnectedAt === undefined && room.storagePausedAt === undefined;
    if (!shouldPlay) stopBgm();
    else if (!audio.current?.bgm) play("ThinkTimeBGM", true);
  }, [snapshot, enabled]);

  return { enabled, toggle: () => setEnabled(value => !value), playCopy: () => {
    const state = audio.current;
    if (!state || !enabledRef.current) return;
    void Promise.all([loading.current.Copy, state.context.resume()]).then(() => {
      if (audio.current === state) play("Copy");
    }).catch(() => undefined);
  } };
}
