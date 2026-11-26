import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, Loader2, RotateCcw, Shuffle } from "lucide-react";
import type { Agent } from "@bubble-ai/core";
import { BUBBLE_COLORS, BUBBLE_SHAPES, GHOST_ACCESSORIES, GHOST_EYES, GHOST_HATS, GHOST_MOTIONS, GHOST_MOUTHS, defaultAppearance, shuffleBubbleLook, type GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { BUBBLE_DEFS, bubbleColor, bubbleParts, bubbleShape } from "../components/Bubble.tsx";
import { BubbleField } from "../components/BubbleField.tsx";
import { Ghost } from "../components/Ghost.tsx";
import { Button, cx } from "../components/ui.tsx";
import { VoicePicker } from "../voice/VoicePicker.tsx";
import { SaveBar } from "./SettingsParts.tsx";

/** What each option is called on screen. The option lists come from core, so they always match the hub. */
export const LOOK_LABELS: Record<string, string> = {
  dots: "Plain",
  big: "Big",
  happy: "Happy",
  sparkle: "Shiny",
  wink: "Wink",
  smile: "Smile",
  open: "Open",
  cat: "Cat",
  fangs: "Fangs",
  tongue: "Tongue",
  none: "None",
  tophat: "Top hat",
  party: "Party",
  beanie: "Beanie",
  crown: "Crown",
  witch: "Witch",
  headphones: "Headphones",
  bow: "Bow",
  halo: "Halo",
  flower: "Flower",
  propeller: "Propeller",
  glasses: "Glasses",
  sunglasses: "Shades",
  monocle: "Monocle",
  bowtie: "Bow tie",
  scarf: "Scarf",
  tie: "Tie",
  mustache: "Mustache",
  float: "Float",
  bounce: "Bounce",
  sway: "Sway",
  still: "Still",
};

/**
 * A look ready for the bubble editor: what it shows today, written out. A look saved before eyes,
 * hats and the rest came back gets the plain set (the same thing it shows now), so opening the
 * editor never changes how an agent looks.
 */
export function withParts(look: GhostAppearance, seed = ""): GhostAppearance {
  if (look.parts) return { ...look, bubble: bubbleShape(look) };
  return { ...look, ...bubbleParts(look), color: bubbleColor(look, seed), color2: undefined, bubble: bubbleShape(look), parts: true };
}

/** The moods you can preview a look in. */
type PreviewMood = "awake" | "working" | "waiting" | "asleep";
const MOODS: [PreviewMood, string][] = [
  ["awake", "Idle"],
  ["working", "Working"],
  ["waiting", "Needs you"],
  ["asleep", "Offline"],
];

const TABS = ["Shape", "Colour", "Eyes", "Mouth", "Hat", "Wear", "Motion"] as const;
export type LookTab = (typeof TABS)[number];

const lower = (c: string | undefined) => c?.toLowerCase();

/**
 * The look's options, one kind at a time: a row of tabs and every choice as a small bubble already
 * wearing it, so you see what you'd get before you pick. Shared by the full editor and New agent.
 */
export function LookOptions({ value: look, onChange, name, dense = false }: { value: GhostAppearance; onChange: (look: GhostAppearance) => void; name: string; dense?: boolean }) {
  const [tab, setTab] = useState<LookTab>("Shape");
  const color = bubbleColor(look, name);
  const set = (patch: Partial<GhostAppearance>) => onChange({ ...look, ...patch, parts: true });
  const tile = dense ? 40 : 50;

  const tiles = <K extends "bubble" | "eyes" | "mouth" | "hat" | "accessory" | "motion">(key: K, options: readonly NonNullable<GhostAppearance[K]>[], label: (v: string) => string) => (
    <div role="radiogroup" aria-label={tab} className={cx("grid gap-1.5", dense ? "grid-cols-[repeat(auto-fill,minmax(58px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(76px,1fr))]")}>
      {options.map((v) => {
        const on = (key === "bubble" ? bubbleShape(look) : look[key]) === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => set({ [key]: v } as Partial<GhostAppearance>)}
            className={cx(
              "look-tile flex flex-col items-center justify-center gap-1 rounded-[12px] text-[11.5px] outline-none transition-[box-shadow,background-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-ring/40",
              dense ? "h-[70px]" : "h-[86px]",
              on ? "bg-side-active text-ink shadow-[inset_0_0_0_1.5px_var(--ink)]" : "text-muted hover:bg-hover hover:text-ink",
            )}
          >
            {/* only the motion tiles move: the rest hold still so the grid stays calm */}
            <Ghost look={{ ...look, parts: true, [key]: v }} seed={name} size={tile} animate={key === "motion"} trackPointer={false} label="" />
            <span className="max-w-full truncate px-1">{label(v)}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* all seven on one line, sharing the width: none drops to a second row or scrolls out of sight */}
      <div role="tablist" aria-label="Look" className="flex gap-0.5">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("min-w-0 flex-1 whitespace-nowrap rounded-full font-medium transition-colors duration-200", dense ? "h-7 px-1 text-[12px]" : "h-8 px-1.5 text-[13px]", tab === t ? "bg-ink text-bg" : "text-muted hover:bg-hover hover:text-ink")}>
            {t}
          </button>
        ))}
      </div>
      <div key={tab} className="look-pane">
        {tab === "Shape" && tiles("bubble", BUBBLE_SHAPES, (v) => BUBBLE_DEFS[v as keyof typeof BUBBLE_DEFS].name)}
        {tab === "Colour" && <ColourRow color={color} onPick={(hex) => set({ color: hex, color2: undefined })} />}
        {tab === "Eyes" && tiles("eyes", GHOST_EYES, (v) => LOOK_LABELS[v] ?? v)}
        {tab === "Mouth" && tiles("mouth", ["none", ...GHOST_MOUTHS.filter((m) => m !== "none")] as const, (v) => LOOK_LABELS[v] ?? v)}
        {tab === "Hat" && tiles("hat", GHOST_HATS, (v) => LOOK_LABELS[v] ?? v)}
        {tab === "Wear" && tiles("accessory", GHOST_ACCESSORIES, (v) => LOOK_LABELS[v] ?? v)}
        {tab === "Motion" && tiles("motion", GHOST_MOTIONS, (v) => LOOK_LABELS[v] ?? v)}
      </div>
    </div>
  );
}

/** The bubble colours, and one of your own. */
export function ColourRow({ color, onPick, size = 28 }: { color: string; onPick: (hex: string) => void; size?: number }) {
  const known = BUBBLE_COLORS.some((c) => c.hex === lower(color));
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap items-center gap-2.5">
      {BUBBLE_COLORS.map((c) => {
        const on = lower(color) === c.hex;
        return <button key={c.hex} type="button" role="radio" aria-checked={on} aria-label={c.name} title={c.name} onClick={() => onPick(c.hex)} className="rounded-full outline-none transition-shadow duration-200 focus-visible:ring-2 focus-visible:ring-ring/40" style={{ width: size, height: size, background: c.hex, boxShadow: on ? "0 0 0 2px var(--panel), 0 0 0 4px var(--ink)" : undefined }} />;
      })}
      <label title="Your own colour" className="relative cursor-pointer overflow-hidden rounded-full" style={{ width: size, height: size, background: known ? "conic-gradient(#ff5f5f, #ffd84d, #5fe08a, #4dabf7, #b07cff, #ff5f5f)" : color, boxShadow: known ? undefined : "0 0 0 2px var(--panel), 0 0 0 4px var(--ink)" }}>
        <input type="color" value={color} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Your own colour" />
      </label>
    </div>
  );
}

/**
 * An agent's Look: its bubble, big, with small bubbles drifting up behind it and a mood to preview
 * it in; then shape, colour, eyes, mouth, hat, what it wears and how it moves, each shown as small
 * bubbles wearing that choice. Controlled: the caller keeps the look and decides when to save.
 */
export function LookEditor({ value: look, onChange, name, extra, speakingLevel, onReset }: { value: GhostAppearance; onChange: (look: GhostAppearance) => void; name: string; extra?: ReactNode; speakingLevel?: number; onReset?: () => void }) {
  const [mood, setMood] = useState<PreviewMood>("awake");
  return (
    <div className="w-full max-w-[560px] space-y-4">
      <div className="relative grid h-[220px] place-items-center overflow-hidden rounded-[16px] bg-card">
        <BubbleField count={14} maxSize={10} rise={300} />
        <Ghost look={look} seed={name} size={140} mood={mood} speakingLevel={speakingLevel} interactive label={`${name}'s bubble`} />
        <div className="absolute right-2.5 top-2.5 flex gap-1">
          <button type="button" onClick={() => onChange(shuffleBubbleLook())} title="Shuffle" aria-label="Shuffle" className="circle circle-sm border-0! bg-panel/70 text-muted hover:text-ink">
            <Shuffle size={15} />
          </button>
          {onReset && (
            <button type="button" onClick={onReset} title="Back to its original look" aria-label="Reset" className="circle circle-sm border-0! bg-panel/70 text-muted hover:text-ink">
              <RotateCcw size={15} />
            </button>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-2.5 flex justify-center">
          <div className="flex rounded-full bg-panel/80 p-0.5 backdrop-blur" role="radiogroup" aria-label="Preview a mood">
            {MOODS.map(([m, label]) => (
              <button key={m} type="button" role="radio" aria-checked={mood === m} onClick={() => setMood(m)} className={cx("h-7 rounded-full px-2.5 text-xs transition-colors", mood === m ? "bg-ink font-semibold text-bg" : "text-muted hover:text-ink")}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <LookOptions value={look} onChange={onChange} name={name} />
      {extra}
    </div>
  );
}

/**
 * The look editor as its own screen: back, the agent's name and Save. It works on a copy; Save hands
 * the look back.
 */
export function LookEditorScreen({ initial, name, onSave, onBack, saving = false, saveLabel = "Save look", error }: { initial: GhostAppearance; name: string; onSave: (look: GhostAppearance) => void; onBack: () => void; saving?: boolean; saveLabel?: string; error?: string | null }) {
  const who = name.trim() || "Your agent";
  const [look, setLook] = useState(() => withParts(initial, who));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="circle circle-sm border-0! bg-chip text-muted hover:text-ink" aria-label="Back">
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
  const fallback = useMemo(() => withParts(defaultAppearance(agent.handle), agent.handle), [agent.handle]);
  const saved = useMemo(() => (agent.settings.appearance ? withParts(agent.settings.appearance, agent.handle) : fallback), [agent.settings.appearance, agent.handle, fallback]);
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
          <div className="overflow-hidden rounded-[12px] bg-card">
            <button type="button" aria-expanded={voiceOpen} onClick={() => setVoiceOpen(!voiceOpen)} className="flex min-h-[46px] w-full items-center gap-3 px-3.5 text-left text-[14px] hover:bg-hover">
              <span className="flex-1 font-medium">Voice</span>
              <ChevronDown size={15} className={cx("shrink-0 text-faint transition-transform duration-200", voiceOpen && "rotate-180")} aria-hidden />
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
