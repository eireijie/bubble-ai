import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import type { Agent } from "@wisp/core";
import { BUBBLE_COLORS, BUBBLE_SHAPES, defaultAppearance, type BubbleShape, type GhostAppearance } from "@wisp/core/src/appearance.ts";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { BUBBLE_DEFS, BubbleBody, bubbleColor, bubbleShape } from "../components/Bubble.tsx";
import { BubbleField } from "../components/BubbleField.tsx";
import { Ghost } from "../components/Ghost.tsx";
import { Button, cx } from "../components/ui.tsx";
import { VoicePicker } from "../voice/VoicePicker.tsx";
import { SaveBar } from "./SettingsParts.tsx";

/** The moods you can preview a look in. */
type PreviewMood = "awake" | "working" | "waiting" | "asleep";
const MOODS: [PreviewMood, string][] = [
  ["awake", "Idle"],
  ["working", "Working"],
  ["waiting", "Needs you"],
  ["asleep", "Offline"],
];

const lower = (c: string | undefined) => c?.toLowerCase();

/**
 * An agent's Look (board 6, "Bubble shapes"): its bubble, big, with small bubbles drifting up
 * behind it; then its shape (eight) and colour (six and your own). Every shape keeps the clear
 * body, rainbow rim and face. Controlled: the caller keeps the look and decides when to save.
 */
export function LookEditor({ value: look, onChange, name, below, extra, speakingLevel, onReset }: { value: GhostAppearance; onChange: (look: GhostAppearance) => void; name: string; below?: ReactNode; extra?: ReactNode; speakingLevel?: number; onReset?: () => void }) {
  const [mood, setMood] = useState<PreviewMood>("awake");
  const shape = bubbleShape(look);
  const color = bubbleColor(look, name);
  const known = BUBBLE_COLORS.some((c) => c.hex === lower(color));
  const setColor = (hex: string) => onChange({ ...look, color: hex, color2: undefined });
  return (
    <div className="w-full max-w-[560px] space-y-4">
      <div className="relative grid h-[200px] place-items-center overflow-hidden rounded-[16px] bg-card">
        <BubbleField count={14} maxSize={10} rise={300} />
        <Ghost look={look} seed={name} size={132} mood={mood} speakingLevel={speakingLevel} interactive label={`${name}'s bubble`} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-chip p-0.5" role="radiogroup" aria-label="Preview a mood">
          {MOODS.map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={mood === m} onClick={() => setMood(m)} className={cx("h-7 rounded-md px-2.5 text-xs", mood === m ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
        {onReset && (
          <button type="button" onClick={onReset} title="Back to its original look" className="ml-auto inline-flex h-8 items-center gap-1.5 text-[13px] text-muted hover:text-ink">
            <RotateCcw size={14} /> Reset
          </button>
        )}
      </div>
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-muted">Shape</h2>
        <div role="radiogroup" aria-label="Shape" className="grid grid-cols-4 gap-2 sm:grid-cols-[repeat(4,76px)]">
          {BUBBLE_SHAPES.map((id) => {
            const on = id === shape;
            const def = BUBBLE_DEFS[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ ...look, bubble: id as BubbleShape })}
                className={cx("flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-[16px] text-[12px] outline-none transition-[box-shadow,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring/40", on ? "bg-side-active text-ink shadow-[inset_0_0_0_2px_var(--wisp)]" : "text-muted hover:bg-hover")}
              >
                <span className="bub" style={{ width: 40, height: 40, ["--bub-c" as string]: color, ["--bub-rim" as string]: "1.4px" }} aria-hidden>
                  <span className="bub-w">
                    <BubbleBody shape={id as BubbleShape} color={color} />
                    <span className="bub-face" style={{ transform: `translate(${def.face[0]}%, ${def.face[1]}%)` }}>
                      <i className="bub-e bub-e1" />
                      <i className="bub-e bub-e2" />
                    </span>
                  </span>
                </span>
                {def.name}
              </button>
            );
          })}
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-muted">Colour</h2>
        <div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-2.5">
          {BUBBLE_COLORS.map((c) => {
            const on = lower(color) === c.hex;
            return <button key={c.hex} type="button" role="radio" aria-checked={on} aria-label={c.name} title={c.name} onClick={() => setColor(c.hex)} className="size-[26px] rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/40" style={{ background: c.hex, boxShadow: on ? "0 0 0 2px var(--panel), 0 0 0 4px var(--ink)" : undefined }} />;
          })}
          {/* your own colour */}
          <label title="Pick your own colour" className="relative size-[26px] cursor-pointer overflow-hidden rounded-full" style={{ background: known ? "conic-gradient(#ff5f5f, #ffd84d, #5fe08a, #4dabf7, #b07cff, #ff5f5f)" : color, boxShadow: known ? undefined : "0 0 0 2px var(--panel), 0 0 0 4px var(--ink)" }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Your own colour" />
          </label>
        </div>
      </section>
      {below}
      {extra}
    </div>
  );
}

/**
 * The look editor as its own screen (from New agent's "Edit look"): back, the agent's name and
 * Save; Shuffle sits under the ghost. It works on a copy; Save hands the look back.
 */
export function LookEditorScreen({ initial, name, onSave, onBack, saving = false, saveLabel = "Save look", error }: { initial: GhostAppearance; name: string; onSave: (look: GhostAppearance) => void; onBack: () => void; saving?: boolean; saveLabel?: string; error?: string | null }) {
  const [look, setLook] = useState(initial);
  const who = name.trim() || "Your agent";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="size-9 rounded-xl bg-chip hover:bg-hover grid place-items-center text-muted hover:text-ink" aria-label="Back">
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 tabIndex={-1} className="t-title truncate">
            {who}'s look
          </h1>
        </div>
        <Button type="button" variant="primary" disabled={saving} onClick={() => onSave(look)}>
          {saving && <Loader2 size={15} className="animate-spin" />} {saveLabel}
        </Button>
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex justify-center">
        <LookEditor value={look} onChange={setLook} name={who} />
      </div>
    </div>
  );
}

/** Look and voice on the agent's page: the editor, and its voice as one row that opens the voice list. Saved with the page's save bar. */
export function LookPanel({ agent, onDirty, active }: { agent: Agent; onDirty: (d: boolean) => void; active: boolean }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const fallback = useMemo(() => defaultAppearance(agent.handle), [agent.handle]);
  const saved = agent.settings.appearance ?? fallback;
  const [look, setLook] = useState<GhostAppearance>(saved);
  const [voice, setVoice] = useState(agent.settings.voice ?? {});
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [speakingLevel, setSpeakingLevel] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(look) !== JSON.stringify(saved) || JSON.stringify(voice) !== JSON.stringify(agent.settings.voice ?? {});
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { settings: { appearance: look, voice } });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <LookEditor
        value={look}
        onChange={setLook}
        name={agent.name}
        onReset={() => setLook(fallback)}
        speakingLevel={speakingLevel}
        extra={
          <div className="overflow-hidden rounded-[14px] bg-card">
            <button type="button" aria-expanded={voiceOpen} onClick={() => setVoiceOpen(!voiceOpen)} className="flex min-h-[46px] w-full items-center gap-3 px-3.5 text-left text-[14px] hover:bg-hover">
              <span className="flex-1 font-medium">Voice</span>
              <ChevronDown size={15} className={cx("shrink-0 text-faint", voiceOpen && "rotate-180")} aria-hidden />
            </button>
            {voiceOpen && (
              <div className="border-t border-line p-3.5">
                <VoicePicker agent={agent} value={voice} onChange={setVoice} onLevel={setSpeakingLevel} />
              </div>
            )}
          </div>
        }
      />
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => { setLook(saved); setVoice(agent.settings.voice ?? {}); }} active={active} />
    </div>
  );
}
