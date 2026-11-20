import { useEffect, useRef, useState } from "react";
import type { GhostShape } from "@wisp/core";
import { useMotionReduced } from "../../theme.ts";
import { FAMILY_COLORS, SHAPE_TO_SILHOUETTE, SILHOUETTES, eyeInk, type Silhouette } from "../../ghostFamily.ts";
import { ONBOARDING_GHOST_STYLE } from "../../components/onboarding/OnboardingGhost.tsx";
import { OnboardingDots } from "../../components/onboarding/GoalsStep.tsx";
import { agentInstructions, cap, loadAnswers, PHRASE, pickedGoals, roleLine, type AgentDraft } from "../../onboardingV3.ts";
export { roleLine };

/** What page 3 learned (its Fact, read loosely so this page works before or without it). */
type Fact = { group: string; text: string };
const factsOf = (a: object): Fact[] => {
  const f = (a as { facts?: unknown }).facts;
  return Array.isArray(f) ? f.filter((x): x is Fact => !!x && typeof x.group === "string" && typeof x.text === "string") : [];
};

const STYLE = `
@keyframes ob-pop { 0% { opacity: 0; transform: translateY(6px) scale(.98); } 100% { opacity: 1; transform: none; } }
.ob-pop { animation: ob-pop .32s cubic-bezier(.32,.72,0,1) both; }
@keyframes ob-hop-a { 0%,100% { transform: none; } 35% { transform: translateY(-14px) scale(.95,1.06); } 70% { transform: translateY(0) scale(1.07,.93); } }
@keyframes ob-hop-b { 0%,100% { transform: none; } 35% { transform: translateY(-14px) scale(.95,1.06); } 70% { transform: translateY(0) scale(1.07,.93); } }
.ob-hop-a { animation: ob-hop-a .5s cubic-bezier(.32,.72,0,1); }
.ob-hop-b { animation: ob-hop-b .5s cubic-bezier(.32,.72,0,1); }
@keyframes ob-page { 0% { opacity: 0; transform: translateX(40px); } 100% { opacity: 1; transform: none; } }
.ob-page { animation: ob-page .45s cubic-bezier(.32,.72,0,1) both; }
.ob-btn { transition: transform .15s ease, background .15s ease, border-color .15s ease; }
.ob-btn:active { transform: scale(.96); }
@media (prefers-reduced-motion: reduce) {
  .ob-pop, .ob-hop-a, .ob-hop-b, .ob-page { animation: none; }
  .ob-btn { transition: none; }
  .ob-btn:active { transform: none; }
}`;

const COLOR_NAMES = ["Violet", "Teal", "Orange", "Blue", "Pink", "Lime"];
const SHAPES: Silhouette[] = ["ghost", "drop", "soft", "tall", "wide", "block"];
const SHAPE_LABEL: Record<Silhouette, string> = { ghost: "Ghost", drop: "Drop", soft: "Soft", tall: "Tall", wide: "Wide", block: "Block" };
const NAME_POOL = ["Juno", "Atlas", "Pip", "Nova", "Milo", "Iris", "Otto", "Wren", "Remy", "Luna"];

/** Family silhouette → the shape the app stores (block has none of its own, so it saves as classic). */
const STORED: Record<Silhouette, GhostShape> = { ...(Object.fromEntries(Object.entries(SHAPE_TO_SILHOUETTE).map(([k, v]) => [v, k])) as Record<Silhouette, GhostShape>), block: "classic" };

/** One thing it learned on page 3 that reads well after "then": work first, never "You're Sam". */
function factLine(facts: readonly Fact[]): string | null {
  const order = ["Work", "Likes", "Tools"] as const;
  for (const g of order) {
    const f = facts.find((x) => x.group === g && !/^you(?:'re| are)\b/i.test(x.text));
    if (f) return f.text.replace(/[.\s]+$/, "").replace(/^([A-Z])(?![A-Z])/, (c) => c.toLowerCase());
  }
  return null;
}

/** "Hi Sam, I'm Juno. I'll start with your inbox, then the spring sale on March 3." */
export function previewLine(person: string, agent: string, goals: readonly string[], facts: readonly Fact[]): string {
  const who = person.trim().split(/\s+/)[0];
  const top = pickedGoals(goals)[0];
  const fact = factLine(facts);
  const hi = `${who ? `Hi ${who}` : "Hi"}, I'm ${agent}.`;
  if (top && fact) return `${hi} I'll start with ${PHRASE[top.id]}, then ${fact}.`;
  if (top) return `${hi} I'll start with ${PHRASE[top.id]}.`;
  if (fact) return `${hi} I'll start with ${fact}.`;
  return `${hi} I'll start by learning how you like things done.`;
}

export const handleOf = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

/** A family ghost in any colour and silhouette: idles, hops, smiles and talks (no cursor follow). */
function AgentGhost({ size, color, silhouette, smiling = false, talking = false, hop = 0 }: { size: number; color: string; silhouette: Silhouette; smiling?: boolean; talking?: boolean; hop?: number }) {
  const reduced = useMotionReduced();
  const shape = SILHOUETTES[silhouette];
  const eye = eyeInk(color);
  const my = shape.ey + 5;
  const md = smiling ? `M18 ${my - 0.3}q2 1.7 4 0` : `M18.7 ${my}h2.6`;
  return (
    <span
      aria-hidden
      className={["wisp-root hello-ghost relative inline-block shrink-0 idle", talking && "talking", reduced && "frozen", size <= 44 && "small"].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <style>{ONBOARDING_GHOST_STYLE}</style>
      <svg width="100%" height="100%" viewBox="0 0 40 40" style={{ overflow: "visible", display: "block" }}>
        <g className="wisp-wander">
          <g key={hop} className={hop ? "wisp-wake hop" : "wisp-wake"}>
            <g className="wisp-bob">
              <g className="wisp-lean">
                <path d={shape.d} fill={color} style={{ transition: reduced ? undefined : "fill .25s ease" }} />
                <g className="wisp-gaze">
                  <g className="wisp-lid">
                    <ellipse className="wisp-eye" cx="16" cy={shape.ey} rx="1.9" ry="2.7" fill={eye} />
                  </g>
                  <g className="wisp-lid">
                    <ellipse className="wisp-eye" cx="24" cy={shape.ey} rx="1.9" ry="2.7" fill={eye} />
                  </g>
                  <path className="hello-mouth" d={md} fill="none" stroke={eye} strokeWidth="1.25" strokeLinecap="round" />
                  <ellipse className="hello-talk" cx="20" cy={my} rx="1.5" ry="1.3" fill={eye} />
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}

type Field = "name" | "role" | "color" | "shape";

/**
 * Page 4 of the first run: make the agent theirs. Everything starts filled in from pages 2 and 3
 * (and keeps following page 3's findings as they arrive, except a field the person changed).
 * Continue only saves a draft; page 5 creates the agent once its AI is chosen.
 */
export function AgentStep({ workspaceId, person, onContinue }: { workspaceId: string; person: string; onContinue: (draft: AgentDraft) => void }) {
  const reduced = useMotionReduced();
  const [answers, setAnswers] = useState(() => loadAnswers(workspaceId));
  const facts = factsOf(answers);
  const draft = answers.agentDraft;
  const touched = useRef<Set<Field>>(new Set(draft ? (["name", "role", "color", "shape"] as Field[]) : []));
  const [name, setName] = useState(draft?.name ?? "Juno");
  const [role, setRole] = useState(() => draft?.role ?? roleLine(answers.goals, answers.other, facts));
  const [color, setColor] = useState<string>(draft?.color ?? FAMILY_COLORS[0]);
  const [shape, setShape] = useState<Silhouette>(draft?.silhouette ?? (draft ? SHAPE_TO_SILHOUETTE[draft.shape] : "ghost"));
  const [hop, setHop] = useState(0);
  const [smile, setSmile] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // page 3 keeps learning in the background and saves what it finds to the answers; follow it
  useEffect(() => {
    const read = () =>
      setAnswers((cur) => {
        const next = loadAnswers(workspaceId);
        return JSON.stringify(factsOf(next)) === JSON.stringify(factsOf(cur)) && next.goals.join() === cur.goals.join() ? cur : next;
      });
    const t = setInterval(read, 1500);
    window.addEventListener("storage", read);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", read);
    };
  }, [workspaceId]);

  const suggestedRole = roleLine(answers.goals, answers.other, facts);
  useEffect(() => {
    if (!touched.current.has("role")) setRole(suggestedRole);
  }, [suggestedRole]);

  // three names, never the person's own
  const first = person.trim().split(/\s+/)[0] ?? "";
  const names = NAME_POOL.filter((n) => n.toLowerCase() !== first.toLowerCase()).slice(0, 3);

  const bump = () => {
    if (reduced) return;
    setHop((h) => h + 1);
    setSmile(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSmile(false), 1100);
  };
  const change = (f: Field) => touched.current.add(f);
  const pickName = (n: string) => (change("name"), setName(n), bump());
  const pickColor = (c: string) => (change("color"), setColor(c), bump());
  const pickShape = (s: Silhouette) => (change("shape"), setShape(s), bump());
  const surprise = () => {
    const any = <T,>(xs: readonly T[], not: T) => {
      const rest = xs.filter((x) => x !== not);
      return rest[Math.floor(Math.random() * rest.length)] ?? not;
    };
    change("name");
    change("color");
    change("shape");
    setName((n) => any(NAME_POOL, n));
    setColor((c) => any(FAMILY_COLORS, c));
    setShape((s) => any(SHAPES, s));
    bump();
  };

  const agent = name.trim() || "your agent";
  const preview = previewLine(person, agent, answers.goals, facts);
  const ok = !!name.trim();
  const save = () => {
    if (!ok) return;
    const n = name.trim();
    const r = role.trim() || suggestedRole;
    onContinue({
      name: n,
      ...(handleOf(n) ? { handle: handleOf(n) } : {}),
      role: r,
      color,
      shape: STORED[shape],
      silhouette: shape,
      instructions: agentInstructions(n, person, r, answers.goals, answers.other),
    });
  };

  const label = "text-[13px] font-semibold text-muted";
  const field = "h-11 box-border px-[18px] rounded-full border border-[var(--input)] bg-[var(--control)] text-ink text-[15px] outline-none focus:border-ink w-full min-w-0";
  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-panel text-ink text-[14px] leading-[22px]">
      <style>{STYLE}</style>
      <div className="h-14 px-6 flex items-center justify-between shrink-0 safe-top">
        <span className="text-[15px] font-[650] tracking-[-0.01em]">Wisp</span>
        <OnboardingDots step={3} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="ob-page min-h-full grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_minmax(0,440px)] gap-10 lg:gap-20 justify-center items-center px-4 sm:px-6 pt-4 pb-10">
          <form
            className="flex flex-col gap-[22px] min-w-0 order-2 lg:order-1"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="flex flex-col gap-0.5">
              <h1 className="text-[24px] leading-[30px] font-[650] tracking-[-0.015em]">Make me yours.</h1>
              <p className="text-[15px] leading-[22px] text-muted">I picked these from what you told me. Change anything.</p>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="ob-agent-name" className={label}>
                Name
              </label>
              <input
                id="ob-agent-name"
                value={name}
                maxLength={40}
                autoComplete="off"
                onChange={(e) => {
                  change("name");
                  setName(e.target.value);
                }}
                className={field}
              />
              <div className="flex gap-1.5 flex-wrap">
                {names.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={name.trim() === n}
                    onClick={() => pickName(n)}
                    className="ob-btn h-[30px] px-3 rounded-[15px] border text-[13px] text-ink bg-panel"
                    style={{ borderColor: name.trim() === n ? "var(--ink)" : "var(--line2)" }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="ob-agent-role" className={label}>
                What I do
              </label>
              <input
                id="ob-agent-role"
                value={role}
                maxLength={200}
                autoComplete="off"
                onChange={(e) => {
                  change("role");
                  setRole(e.target.value);
                }}
                className={field}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className={label}>Colour</span>
              <div className="flex gap-2.5 flex-wrap" role="group" aria-label="Colour">
                {FAMILY_COLORS.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={COLOR_NAMES[i]}
                    aria-pressed={color === c}
                    onClick={() => pickColor(c)}
                    className="ob-btn w-9 h-9 rounded-full p-[3px] bg-panel border-2"
                    style={{ borderColor: color === c ? "var(--ink)" : "transparent" }}
                  >
                    <span className="block w-full h-full rounded-full" style={{ background: c }} />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className={label}>Shape</span>
              <div className="flex gap-2 flex-wrap" role="group" aria-label="Shape">
                {SHAPES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-label={SHAPE_LABEL[s]}
                    aria-pressed={shape === s}
                    onClick={() => pickShape(s)}
                    className="ob-btn w-14 h-14 rounded-[14px] border flex items-center justify-center p-0"
                    style={{ borderColor: shape === s ? "var(--ink)" : "var(--line2)", background: shape === s ? `${color}1f` : "var(--panel)" }}
                  >
                    <svg width="36" height="36" viewBox="0 0 40 40" aria-hidden style={{ overflow: "visible" }}>
                      <path d={SILHOUETTES[s].d} fill={color} />
                      <ellipse cx="16" cy={SILHOUETTES[s].ey} rx="1.9" ry="2.7" fill={eyeInk(color)} />
                      <ellipse cx="24" cy={SILHOUETTES[s].ey} rx="1.9" ry="2.7" fill={eyeInk(color)} />
                    </svg>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 items-center pt-1">
              <button type="submit" disabled={!ok} className="ob-btn setup-press h-11 px-[22px] rounded-full bg-ink text-panel font-semibold disabled:opacity-40">
                Continue
              </button>
              <button type="button" onClick={surprise} className="ob-btn h-11 px-4 rounded-full border border-[var(--line2)] bg-panel text-ink">
                Surprise me
              </button>
            </div>
          </form>

          <div className="flex flex-col items-center gap-[22px] min-w-0 order-1 lg:order-2">
            <div className="w-full max-w-[440px] h-[220px] lg:h-[300px] rounded-[24px] bg-[var(--card)] flex items-center justify-center">
              <span className={hop === 0 ? "block" : hop % 2 ? "block ob-hop-a" : "block ob-hop-b"} style={{ transformOrigin: "50% 100%" }}>
                <AgentGhost size={168} color={color} silhouette={shape} smiling={smile} talking={smile} />
              </span>
            </div>
            <div className="w-full max-w-[440px] flex gap-2.5 items-start" aria-live="polite">
              <AgentGhost size={28} color={color} silhouette={shape} />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[13px] font-semibold truncate">{agent}</span>
                <span key={preview} className="ob-pop bg-[var(--card)] rounded-[18px] px-3.5 py-[9px] self-start">
                  {preview}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
