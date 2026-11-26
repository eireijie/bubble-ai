import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Mic, MicOff, PhoneOff } from "lucide-react";
import type { Agent } from "@bubble-ai/core";
import { defaultAppearance } from "@bubble-ai/core/src/appearance.ts";
import { api, observeEvents } from "../api.ts";
import { useStore } from "../store.ts";
import { Ghost } from "../components/Ghost.tsx";
import { cx } from "../components/ui.tsx";
import { familyColor } from "../ghostFamily.ts";
import { VoiceCall, INITIAL_CALL, type CallState } from "./call.ts";
import { callFacts, type CallFacts } from "./facts.ts";
import { callPrefs, setCallPrefs, SPEEDS, speedLabel, useCallPrefs } from "./prefs.ts";
import { NEEDS_KEY_BROWSER, NEEDS_KEY_DESKTOP } from "./engine.ts";
import { createListener, createSpeaker, effectiveListen, inDesktopApp, type VoiceSettings, type VoiceSpeaker } from "./providers.ts";
import "./voice.css";

/** One line said on the call, for the transcript and the record left in the chat. */
export interface CallLine { who: "you" | "agent"; text: string }
/** What stays in the chat when a call ends. */
export interface CallRecord { agentId: string; seconds: number; lines: CallLine[]; endedAt: number }

/** What to do about a blocked microphone, in the words of the place Bubble AI is running. */
export function micHelp(agentName: string, desktop = inDesktopApp()): string {
  const where = desktop
    ? "Allow it in System Settings → Privacy & Security → Microphone → Bubble AI, then try again."
    : "Allow it in your browser (the lock beside the address), then try again.";
  return `Bubble AI needs your microphone to hear you. ${where} ${agentName} will still answer in chat.`;
}

/** When no listening engine works, the card says what to set up instead of blaming the microphone. */
export const micCardText = (agentName: string, error: string) => (error === NEEDS_KEY_DESKTOP || error === NEEDS_KEY_BROWSER ? error : micHelp(agentName));

/** In the desktop app, ask the computer for the microphone, or open its Microphone settings when it was already refused. */
async function askForMicrophone() {
  const mic = window.wispDesktop?.microphone;
  if (!mic) return;
  try {
    const status = await mic.status();
    if (status === "not-determined") await mic.request();
    else if (status === "denied" || status === "restricted") await mic.openSettings();
  } catch { /* the call tries the microphone again either way */ }
}

export function CallScreen({ agent, channelId, onClose }: { agent: Agent; channelId: string; onClose(record?: CallRecord): void }) {
  const [state, setState] = useState(INITIAL_CALL);
  const [seconds, setSeconds] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const call = useRef<VoiceCall | null>(null);
  const voiceRef = useRef(agent.settings.voice);
  voiceRef.current = agent.settings.voice;
  const connected = useStore((s) => s.connected);
  const prefs = useCallPrefs();
  const offline = agent.status === "offline";
  useEffect(() => {
    setState(INITIAL_CALL); setSeconds(0);
    if (offline) return;
    let disposed = false;
    const unsubscribe = observeEvents((e) => call.current?.event(e));
    void api<VoiceSettings>("GET", "/api/voice/settings").then(async (settings) => {
      if (disposed) return;
      // the voice and speed are read at every reply, so changing them in the agent panel is heard right away
      let current: VoiceSpeaker | null = null;
      const speaker: VoiceSpeaker = {
        speak(text, level) { current?.cancel(); current = createSpeaker(settings.speak, voiceRef.current, agent.handle, () => callPrefs().speed); return current.speak(text, level); },
        cancel() { current?.cancel(); },
        // fetched audio is shared across speakers, so a fresh one can warm it up
        prepare(text) { createSpeaker(settings.speak, voiceRef.current, agent.handle).prepare?.(text); },
      };
      const session = new VoiceCall({
        agentId: agent.id, channelId, cloudListening: effectiveListen(settings) === "openai",
        listener: (cb) => createListener(settings, cb, () => callPrefs().language),
        speaker,
        send: (body) => api("POST", `/api/channels/${channelId}/messages`, { body, voice: true }),
        update: setState,
        messages: () => useStore.getState().messages[channelId] ?? [],
        refresh: () => useStore.getState().loadChannel(channelId),
      });
      call.current = session;
      if (useStore.getState().connected) await session.start(); else session.disconnect();
    }).catch((e) => { if (!disposed) setState((s) => ({ ...s, error: e.message })); });
    return () => { disposed = true; unsubscribe(); call.current?.stop(); call.current = null; };
  }, [agent.id, channelId, offline, attempt]);
  useEffect(() => {
    const startedAt = state.startedAt;
    if (startedAt === null || offline) return;
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state.startedAt, offline]);
  useEffect(() => {
    if (!connected) call.current?.disconnect();
    else if (call.current && !call.current.state.ready) void call.current.start();
  }, [connected]);
  // the transcript: a new line each time the speaker changes, the newest line follows its caption
  const [lines, setLines] = useState<CallLine[]>([]);
  const said = (who: CallLine["who"], text: string) => {
    if (!text.trim()) return;
    setLines((all) => (all.length && all[all.length - 1].who === who ? [...all.slice(0, -1), { who, text }] : [...all, { who, text }]));
  };
  useEffect(() => said("you", state.userCaption), [state.userCaption]);
  useEffect(() => said("agent", state.agentCaption), [state.agentCaption]);
  const close = () => {
    call.current?.stop();
    onClose(state.startedAt !== null || lines.length ? { agentId: agent.id, seconds, lines, endedAt: Date.now() } : undefined);
  };
  const retry = async () => {
    if (state.needsMic) await askForMicrophone();
    if (call.current) void call.current.start(); else setAttempt((n) => n + 1);
  };
  const toggleMute = () => void call.current?.mute(!state.muted);

  const facts = callFacts({ agent, state, connected, seconds, showActivity: prefs.showActivity });
  return <CallCard agent={agent} state={state} facts={facts} lines={lines} transcript={prefs.showTranscript} onMute={toggleMute} onRetry={retry} onEnd={close} />;
}

const BARS = [8, 14, 20, 12, 22, 16, 9, 18, 22, 13, 7, 17, 21, 11];

/**
 * The call: a bar floating under the agent's name pill. The ghost, a waveform, what's happening,
 * Mute and End. The chat stays readable under it (the message list makes room for the bar), and
 * what you both say lands there as messages; "Show transcript" (agent panel › More) also lists it here.
 */
export function CallCard({ agent, state, facts, lines, transcript, onMute, onRetry, onEnd }: {
  agent: Agent; state: CallState; facts: CallFacts; lines: CallLine[]; transcript: boolean;
  onMute(): void; onRetry(): void; onEnd(): void;
}) {
  const { offline, phase, paused, failed, micTrouble, label, activity, timer } = facts;
  const look = agent.settings.appearance ?? defaultAppearance(agent.handle);
  const color = familyColor(look, agent.handle);
  const level = state.speaking ? state.speechLevel : state.micLevel;
  const quiet = offline || state.muted || !state.ready || phase === "connecting";
  // with the transcript off, what it is doing ("Reading main.ts") takes the status line
  const status = [state.muted ? "Muted" : offline ? `${agent.name} is asleep` : phase === "speaking" ? `${agent.name} is talking` : (!transcript && activity) || label, timer].filter(Boolean).join(" · ");
  return (
    <section className="call-card absolute left-1/2 top-[58px] z-30 w-[min(400px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-[16px] border border-line2 bg-float shadow-float" aria-label={`Call with ${agent.name}`}>
      <div className={cx("flex h-[72px] items-center gap-2.5 pl-3 pr-3.5", quiet && "call-muted")}>
        <Ghost look={look} size={44} mood={offline ? "asleep" : phase === "working" || phase === "thinking" || phase === "speaking" ? "working" : "awake"} label="" seed={agent.handle} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="call-wave flex h-[22px] items-center gap-[3px]" aria-hidden style={{ "--amp": (0.45 + Math.min(1, level) * 0.55).toFixed(2) } as CSSProperties}>
            {BARS.map((h, i) => <span key={i} className="call-bar w-[3px] rounded-[2px]" style={{ height: h, background: color, animationDelay: `-${((i * 0.13) % 0.9).toFixed(2)}s` }} />)}
          </span>
          <span className="truncate text-xs leading-4 text-muted" role="status">{status}</span>
        </span>
        <button type="button" onClick={onMute} aria-label={state.muted ? "Unmute" : "Mute"} aria-pressed={state.muted} title={state.muted ? "Unmute" : "Mute"} disabled={offline || (!state.ready && !state.muted)} className={cx("call-btn grid size-11 shrink-0 place-items-center rounded-full text-ink disabled:opacity-40", state.muted ? "bg-side-active" : "bg-hover hover:bg-side-active")}>{state.muted ? <MicOff size={19} strokeWidth={1.7} /> : <Mic size={19} strokeWidth={1.7} />}</button>
        <button type="button" onClick={onEnd} aria-label="End call" title="End call" className="call-btn grid size-11 shrink-0 place-items-center rounded-full bg-[#e5484d] text-white hover:bg-[#d93d42]"><PhoneOff size={19} strokeWidth={1.8} /></button>
      </div>

      {(micTrouble || failed || paused) && (
        <div className="flex flex-col gap-2.5 border-t border-line px-3.5 py-3 text-[13px] leading-5 text-muted" role="alert">
          {micTrouble ? <p>{micCardText(agent.name, state.error)}</p> : failed ? <p>{state.error || "Couldn't connect just yet."}</p> : <p>On hold. The reply will be in chat.</p>}
          <span className="flex gap-2">
            <button type="button" onClick={onRetry} className="h-8 rounded-[8px] bg-ink px-3.5 text-[13px] font-semibold text-panel">{paused ? "Resume" : "Try again"}</button>
            {failed && <a href="#/settings/voice" onClick={onEnd} className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-line2 px-3.5 text-[13px] text-ink">Voice settings<ChevronRight size={14} aria-hidden /></a>}
          </span>
        </div>
      )}

      {transcript && (lines.length > 0 || !!activity) && (
        <div className="call-lines flex max-h-[min(320px,45vh)] flex-col gap-2 overflow-y-auto border-t border-line px-3.5 pb-3.5 pt-3" aria-live="polite">
          {lines.map((l, i) => (
            <div key={i} className={cx("max-w-[340px] rounded-2xl px-[13px] py-[7px] text-[13px] leading-5", l.who === "you" ? "self-end bg-[var(--bubble-me)] text-[var(--bubble-me-ink)]" : "self-start bg-[var(--bubble-them)] text-ink")}>{l.text}</div>
          ))}
          {activity && (
            <div className="flex items-center gap-[7px] self-start text-xs text-muted">
              <Ghost look={look} size={18} mood="working" label="" seed={agent.handle} />
              {activity}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const LANGUAGES: [string, string][] = [["", "Auto-detect"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["es-ES", "Spanish"], ["fr-FR", "French"], ["de-DE", "German"], ["it-IT", "Italian"], ["pt-BR", "Portuguese"], ["ja-JP", "Japanese"], ["ko-KR", "Korean"], ["zh-CN", "Chinese"], ["hi-IN", "Hindi"]];

/**
 * How calls sound and what they show, for this person on this device: speed, language, the
 * "what it's doing" line and the transcript. Lives in the agent panel › More (the voice itself is
 * picked under Look and voice); a change is heard on the very next reply of a call that is on.
 */
export function CallOptions() {
  const prefs = useCallPrefs();
  const speedPct = ((prefs.speed - SPEEDS[0]) / (SPEEDS[SPEEDS.length - 1] - SPEEDS[0])) * 100;
  const check = "size-4 accent-[var(--wisp)]";
  return (
    <div className="flex flex-col gap-3 text-[14px]" role="group" aria-label="Calls">
      <label className="flex items-center gap-3">
        <span className="w-[52px] shrink-0">Speed</span>
        <input type="range" min={0} max={SPEEDS.length - 1} step={1} value={Math.max(0, SPEEDS.indexOf(prefs.speed))} onChange={(e) => setCallPrefs({ speed: SPEEDS[Number(e.target.value)] })} aria-label="Speed" className="call-range min-w-0 flex-1" style={{ "--pct": `${speedPct}%` } as CSSProperties} />
        <span className="w-10 shrink-0 text-right text-[13px] tabular-nums text-muted">{speedLabel(prefs.speed)}</span>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span>Language</span>
        <span className="relative">
          <select aria-label="Language" value={prefs.language} onChange={(e) => setCallPrefs({ language: e.target.value })} className="h-[30px] appearance-none rounded-[10px] border border-line2 bg-transparent pl-3 pr-7 text-[13px] text-ink">
            {LANGUAGES.map(([tag, name]) => <option key={tag} value={tag}>{name}</option>)}
          </select>
          <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-[9px] text-muted" aria-hidden />
        </span>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span>Show what it's doing</span>
        <input type="checkbox" checked={prefs.showActivity} onChange={() => setCallPrefs({ showActivity: !prefs.showActivity })} className={check} />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span>Show transcript</span>
        <input type="checkbox" checked={prefs.showTranscript} onChange={() => setCallPrefs({ showTranscript: !prefs.showTranscript })} className={check} />
      </label>
    </div>
  );
}
