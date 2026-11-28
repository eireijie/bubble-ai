import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, Loader2, RotateCcw, Shuffle } from "lucide-react";
import type { Agent } from "@bubble-ai/core";
import { BUBBLE_COLORS, BUBBLE_SHAPES, GHOST_ACCESSORIES, GHOST_EYES, GHOST_HATS, GHOST_MOTIONS, GHOST_MOUTHS, defaultAppearance, shuffleBubbleLook, type GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import { api } from "../api.ts";
import { mergeLook } from "../components/lookPhoto.tsx";
import { useStore } from "../store.ts";
import { BUBBLE_DEFS, bubbleColor, bubbleParts, bubbleShape } from "../components/Bubble.tsx";
import { BubbleField } from "../components/BubbleField.tsx";
import { Ghost } from "../components/Ghost.tsx";
import { Button, cx } from "../components/ui.tsx";
import { SaveBar } from "./SettingsParts.tsx";
import "./look-rows.css";

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

const lower = (c: string | undefined) => c?.toLowerCase();

type LookKey = "bubble" | "eyes" | "mouth" | "hat" | "accessory" | "motion";

/** One kind of choice as a wrap of small tiles, each the real bubble wearing that choice (its name on hover). */
function LookTiles<K extends LookKey>({ look, name, k, options, label, onPick }: { look: GhostAppearance; name: string; k: K; options: readonly NonNullable<GhostAppearance[K]>[]; label: (v: string) => string; onPick: (patch: Partial<GhostAppearance>) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((v) => {
        const on = (k === "bubble" ? bubbleShape(look) : look[k]) === v;
        const title = label(v);
        return (
          <button key={v} type="button" role="radio" aria-checked={on} aria-label={title} title={title} data-on={on || undefined} onClick={() => onPick({ [k]: v } as Partial<GhostAppearance>)} className="look-tile">
            {/* only the motion tiles move, so the rows stay calm */}
            <Ghost look={{ ...look, parts: true, [k]: v }} seed={name} size={30} animate={k === "motion"} trackPointer={false} label="" />
          </button>
        );
      })}
    </div>
  );
}

/** A labelled group of choices in the look editor. */
function LookGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="space-y-2">
      <div className="px-0.5 text-[12px] font-semibold text-muted">{label}</div>
      {children}
    </div>
  );
}

/**
 * The look as seven short rows, one per kind (New agent): a label, then every choice as a small
 * swatch, all in view at once. A row too long for its column scrolls sideways and fades at the edge
 * that has more. Each swatch is the real bubble wearing that choice, so it shows what you'd get.
 */
export function LookRows({ value: look, onChange, name }: { value: GhostAppearance; onChange: (look: GhostAppearance) => void; name: string }) {
  const color = bubbleColor(look, name);
  const set = (patch: Partial<GhostAppearance>) => onChange({ ...look, ...patch, parts: true });
  const known = BUBBLE_COLORS.some((c) => c.hex === lower(color));
  const swatches = <K extends "bubble" | "eyes" | "mouth" | "hat" | "accessory" | "motion">(key: K, options: readonly NonNullable<GhostAppearance[K]>[], label: (v: string) => string) =>
    options.map((v) => {
      const on = (key === "bubble" ? bubbleShape(look) : look[key]) === v;
      const title = label(v);
      return (
        <button key={v} type="button" role="radio" aria-checked={on} aria-label={title} title={title} data-on={on || undefined} onClick={() => set({ [key]: v } as Partial<GhostAppearance>)} className="look-sw">
          {/* only the motion swatches move, so the rows stay calm */}
          <Ghost look={{ ...look, parts: true, [key]: v }} seed={name} size={24} animate={key === "motion"} trackPointer={false} label="" />
        </button>
      );
    });
  return (
    <div className="look-rows">
      <LookRow label="Shape">{swatches("bubble", BUBBLE_SHAPES, (v) => BUBBLE_DEFS[v as keyof typeof BUBBLE_DEFS].name)}</LookRow>
      <LookRow label="Colour">
        {BUBBLE_COLORS.map((c) => {
          const on = lower(color) === c.hex;
          return (
            <button key={c.hex} type="button" role="radio" aria-checked={on} aria-label={c.name} title={c.name} data-on={on || undefined} onClick={() => set({ color: c.hex, color2: undefined })} className="look-sw">
              <span className="look-dot" style={{ background: c.hex }} />
            </button>
          );
        })}
        <label title="Your own colour" data-on={!known || undefined} className="look-sw cursor-pointer">
          <span className="look-dot" style={{ background: known ? "conic-gradient(#ff5f5f, #ffd84d, #5fe08a, #4dabf7, #b07cff, #ff5f5f)" : color }} />
          <input type="color" value={color} onChange={(e) => set({ color: e.target.value, color2: undefined })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Your own colour" />
        </label>
      </LookRow>
      <LookRow label="Eyes">{swatches("eyes", GHOST_EYES, (v) => LOOK_LABELS[v] ?? v)}</LookRow>
      <LookRow label="Mouth">{swatches("mouth", ["none", ...GHOST_MOUTHS.filter((m) => m !== "none")] as const, (v) => LOOK_LABELS[v] ?? v)}</LookRow>
      <LookRow label="Hat">{swatches("hat", GHOST_HATS, (v) => LOOK_LABELS[v] ?? v)}</LookRow>
      <LookRow label="Wear">{swatches("accessory", GHOST_ACCESSORIES, (v) => LOOK_LABELS[v] ?? v)}</LookRow>
      <LookRow label="Motion">{swatches("motion", GHOST_MOTIONS, (v) => LOOK_LABELS[v] ?? v)}</LookRow>
    </div>
  );
}

/** One row of swatches: it scrolls sideways when it doesn't fit, fading on the side that has more, and opens with the picked one in view. */
function LookRow({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<"" | "start" | "end" | "both">("");
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore(start && end ? "both" : start ? "start" : end ? "end" : "");
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const picked = el.querySelector<HTMLElement>("[data-on]");
    if (picked && picked.offsetLeft + picked.offsetWidth > el.clientWidth) el.scrollLeft = picked.offsetLeft - el.clientWidth / 2 + picked.offsetWidth / 2;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return (
    <div className="look-row">
      <span className="look-row-label" aria-hidden>
        {label}
      </span>
      <div ref={ref} role="radiogroup" aria-label={label} onScroll={measure} data-more={more || undefined} className="look-row-sw">
        {children}
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
 * An agent's look (canvas round 4, board Look): its bubble, live, then Shape, Colour, Hat and Wear,
 * each choice shown as a small bubble already wearing it. Eyes, mouth, how it moves and a mood to
 * preview it in are under a small "More". Controlled: the caller keeps the look and decides when to save.
 */
export function LookEditor({ value: look, onChange, name, extra, speakingLevel, onReset }: { value: GhostAppearance; onChange: (look: GhostAppearance) => void; name: string; extra?: ReactNode; speakingLevel?: number; onReset?: () => void }) {
  const [mood, setMood] = useState<PreviewMood>("awake");
  const [more, setMore] = useState(false);
  const color = bubbleColor(look, name);
  const set = (patch: Partial<GhostAppearance>) => onChange({ ...look, ...patch, parts: true });
  const label = (v: string) => LOOK_LABELS[v] ?? v;
  return (
    <div className="w-full max-w-[560px] space-y-5">
      <div className="relative grid h-[170px] place-items-center overflow-hidden rounded-[16px] bg-card">
        <BubbleField count={12} maxSize={9} rise={240} />
        <Ghost look={look} seed={name} size={112} mood={mood} speakingLevel={speakingLevel} interactive label={`${name}'s bubble`} />
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
      </div>
      <LookGroup label="Shape">
        <LookTiles look={look} name={name} k="bubble" options={BUBBLE_SHAPES} label={(v) => BUBBLE_DEFS[v as keyof typeof BUBBLE_DEFS].name} onPick={set} />
      </LookGroup>
      <div className="space-y-2">
        <div className="px-0.5 text-[12px] font-semibold text-muted">Colour</div>
        <ColourRow color={color} onPick={(hex) => set({ color: hex, color2: undefined })} />
      </div>
      <LookGroup label="Hat">
        <LookTiles look={look} name={name} k="hat" options={GHOST_HATS} label={label} onPick={set} />
      </LookGroup>
      <LookGroup label="Wear">
        <LookTiles look={look} name={name} k="accessory" options={GHOST_ACCESSORIES} label={label} onPick={set} />
      </LookGroup>
      <div>
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="-ml-1 inline-flex h-8 items-center gap-1 rounded-[8px] px-1.5 text-[13px] font-medium text-muted hover:bg-hover hover:text-ink">
          More <ChevronDown size={14} className={cx("transition-transform duration-200", more && "rotate-180")} aria-hidden />
        </button>
        {more && (
          <div className="look-pane mt-3 space-y-5">
            <LookGroup label="Eyes">
              <LookTiles look={look} name={name} k="eyes" options={GHOST_EYES} label={label} onPick={set} />
            </LookGroup>
            <LookGroup label="Mouth">
              <LookTiles look={look} name={name} k="mouth" options={["none", ...GHOST_MOUTHS.filter((m) => m !== "none")] as const} label={label} onPick={set} />
            </LookGroup>
            <LookGroup label="Motion">
              <LookTiles look={look} name={name} k="motion" options={GHOST_MOTIONS} label={label} onPick={set} />
            </LookGroup>
            <LookGroup label="Preview as">
              <div className="flex flex-wrap gap-1.5">
                {MOODS.map(([m, text]) => (
                  <button key={m} type="button" role="radio" aria-checked={mood === m} onClick={() => setMood(m)} className={cx("h-8 rounded-full px-3 text-[13px] transition-colors", mood === m ? "bg-ink font-medium text-bg" : "bg-card text-muted hover:text-ink")}>
                    {text}
                  </button>
                ))}
              </div>
            </LookGroup>
          </div>
        )}
      </div>
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

/** The look in the agent's profile (its avatar's pencil): the editor, saved with the save bar. Its voice is the profile's Voice tab. */
export function LookPanel({ agent, onDirty, active }: { agent: Agent; onDirty: (d: boolean) => void; active: boolean }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const fallback = useMemo(() => withParts(defaultAppearance(agent.handle), agent.handle), [agent.handle]);
  const saved = useMemo(() => (agent.settings.appearance ? withParts(agent.settings.appearance, agent.handle) : fallback), [agent.settings.appearance, agent.handle, fallback]);
  const [look, setLook] = useState<GhostAppearance>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(look) !== JSON.stringify(saved);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // laid over what's saved, so a photo (iPhone, or Bubble look) and newer fields aren't lost
      await api("PATCH", `/api/agents/${agent.id}`, { settings: { appearance: mergeLook(agent.settings.appearance, look) } });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center">
      {/* drawing the bubble means using it: a photo face gives way, as on the iPhone */}
      <LookEditor value={look} onChange={(l) => setLook({ ...l, photo: undefined })} name={agent.name} onReset={() => setLook({ ...fallback, photo: undefined })} />
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setLook(saved)} active={active} />
    </div>
  );
}
