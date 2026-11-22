import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, Loader2, RotateCcw, Shuffle } from "lucide-react";
import type { Agent } from "@wisp/core";
import { GHOST_ACCESSORIES, GHOST_EYES, GHOST_HATS, GHOST_MOTIONS, GHOST_MOUTHS, GHOST_SHAPES, defaultAppearance, randomAppearance, type GhostAppearance } from "@wisp/core/src/appearance.ts";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { GhostColors } from "../components/GhostColors.tsx";
import { Ghost } from "../components/Ghost.tsx";
import { Button, cx } from "../components/ui.tsx";
import { VoicePicker } from "../voice/VoicePicker.tsx";
import { SaveBar } from "./SettingsParts.tsx";

/** What each option is called on screen. The option lists themselves come from core, so they always match the hub. */
export const LOOK_LABELS: Record<string, string> = {
  classic: "Classic",
  round: "Round",
  tall: "Tall",
  sheet: "Sheet",
  wisp: "Wisp",
  dots: "Dots",
  big: "Big",
  happy: "Happy",
  sparkle: "Sparkle",
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
  sunglasses: "Sunglasses",
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

/** The moods you can preview a look in. */
type PreviewMood = "awake" | "working" | "asleep";
const MOODS: [PreviewMood, string][] = [
  ["awake", "Awake"],
  ["working", "Working"],
  ["asleep", "Asleep"],
];

/** The long lists, one at a time. */
const CUSTOMIZE = ["Colors", "Shape", "Face", "Hat", "Accessory", "Motion"] as const;

/**
 * The look editor: the ghost, big and watching your pointer, with Shuffle and a few colors. Every
 * other option (all colors, shape, eyes, mouth, rosy cheeks, hat, accessory, motion, the mood to
 * preview it in, and Reset when the caller has one) is behind "Show all", one list at a time.
 * Controlled: the caller keeps the look and decides when to save.
 */
export function LookEditor({ value: look, onChange, name, below, extra, speakingLevel, onReset }: { value: GhostAppearance; onChange: (look: GhostAppearance) => void; name: string; below?: ReactNode; extra?: ReactNode; speakingLevel?: number; onReset?: () => void }) {
  const [mood, setMood] = useState<PreviewMood>("awake");
  const [all, setAll] = useState(false);
  const [tab, setTab] = useState<(typeof CUSTOMIZE)[number]>("Colors");
  const set = <K extends keyof GhostAppearance>(k: K, v: GhostAppearance[K]) => onChange({ ...look, [k]: v });
  return (
    <div className="w-full max-w-[560px] space-y-4">
      <div className="grid h-64 place-items-center overflow-hidden rounded-[14px] bg-card sm:h-72">
        <Ghost look={look} size={200} mood={mood} speakingLevel={speakingLevel} trackPointer interactive label={`${name}'s ghost, looking toward your pointer`} />
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button type="button" onClick={() => onChange(randomAppearance())}>
          <Shuffle size={15} /> Shuffle
        </Button>
        {!all && <GhostColors look={look} onChange={(c) => onChange({ ...look, ...c })} limit={5} />}
        {below}
      </div>
      {extra}
      <div className="overflow-hidden rounded-[14px] bg-card">
        {all && (
          <div className="space-y-4 border-b border-line p-3.5">
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Look options">
              {CUSTOMIZE.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("h-8 shrink-0 rounded-lg px-3 text-[13px] font-medium", tab === t ? "bg-side-active text-ink" : "text-muted hover:text-ink")}>
                  {t}
                </button>
              ))}
            </div>
            {tab === "Colors" && <GhostColors look={look} onChange={(c) => onChange({ ...look, ...c })} labels />}
            {tab === "Shape" && <Chips bare title="Shape" options={GHOST_SHAPES} value={look.shape} onPick={(v) => set("shape", v)} />}
            {tab === "Face" && (
              <>
                <Chips title="Eyes" options={GHOST_EYES} value={look.eyes} onPick={(v) => set("eyes", v)} />
                <Chips title="Mouth" options={GHOST_MOUTHS} value={look.mouth} onPick={(v) => set("mouth", v)} />
                <button type="button" aria-pressed={look.cheeks} onClick={() => set("cheeks", !look.cheeks)} className={cx(CHIP, look.cheeks ? CHIP_ON : CHIP_OFF)}>
                  Rosy cheeks
                </button>
              </>
            )}
            {tab === "Hat" && <Chips bare title="Hat" options={GHOST_HATS} value={look.hat} onPick={(v) => set("hat", v)} />}
            {tab === "Accessory" && <Chips bare title="Accessory" options={GHOST_ACCESSORIES} value={look.accessory} onPick={(v) => set("accessory", v)} />}
            {tab === "Motion" && <Chips bare title="Motion" options={GHOST_MOTIONS} value={look.motion} onPick={(v) => set("motion", v)} />}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <div className="flex rounded-lg bg-chip p-0.5" role="radiogroup" aria-label="Preview a mood">
                {MOODS.map(([m, label]) => (
                  <button key={m} type="button" role="radio" aria-checked={mood === m} onClick={() => setMood(m)} className={cx("h-7 rounded-md px-2.5 text-xs", mood === m ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink")}>
                    {label}
                  </button>
                ))}
              </div>
              {onReset && (
                <button type="button" onClick={onReset} title="Back to its original ghost" className="ml-auto inline-flex h-8 items-center gap-1.5 text-[13px] text-muted hover:text-ink">
                  <RotateCcw size={14} /> Reset
                </button>
              )}
            </div>
          </div>
        )}
        <button type="button" aria-expanded={all} onClick={() => setAll(!all)} className="flex min-h-[46px] w-full items-center gap-3 px-3.5 text-left text-[14px] text-muted hover:bg-hover hover:text-ink">
          <span className="flex-1">{all ? "Show less" : "Show all"}</span>
          <ChevronDown size={15} className={cx("shrink-0 text-faint", all && "rotate-180")} aria-hidden />
        </button>
      </div>
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

const CHIP = "h-9 px-3.5 rounded-full border text-[13px] font-medium transition-colors";
const CHIP_ON = "bg-ink text-bg border-ink";
const CHIP_OFF = "bg-panel text-ink border-line hover:bg-hover";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[13px] font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
}

/** One option list as chips. `bare` leaves out the heading (the tab already names it). */
function Chips<T extends string>({ title, options, value, onPick, bare }: { title: string; options: readonly T[]; value: T; onPick: (v: T) => void; bare?: boolean }) {
  const chips = (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={title}>
      {options.map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onPick(v)} className={cx(CHIP, value === v ? CHIP_ON : CHIP_OFF)}>
          {LOOK_LABELS[v] ?? v}
        </button>
      ))}
    </div>
  );
  return bare ? chips : <Section title={title}>{chips}</Section>;
}
