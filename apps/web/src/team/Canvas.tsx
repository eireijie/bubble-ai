import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Clock, Plus, Share2, Trash2, UserCheck } from "lucide-react";
import { stepAgentId, stepGraph, stepOrder, type ChannelTeam, type TeamStep } from "@bubble-ai/core";
import { useStore } from "../store.ts";
import { AgentAvatar, agentColor, cx } from "../components/ui.tsx";
import { nextText, whenText } from "./ScheduleForm.tsx";
import { ADD_KINDS, BOX_H, BOX_W, backLabel, cardSentence, fromCanvas, numberOf, stepById, titleOf, toCanvas, type AddAt, type AddKind, KIND_MARK } from "./flow.ts";
import { KindIcon, MessageChip, useHandoffName } from "./parts.tsx";

type Pt = { x: number; y: number };

const MIN_K = 0.3;
const MAX_K = 2;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const CHIP_W = 176;

/** A smooth curve from the right side of one box to the left side of the next, with its midpoint (for the +). */
function across(a: Pt, b: Pt) {
  const reach = Math.max(48, Math.abs(b.x - a.x) / 2);
  const c1 = { x: a.x + reach, y: a.y };
  const c2 = { x: b.x - reach, y: b.y };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, mid: { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 } };
}

/** A loop back: out of the bottom of a box, round underneath, into the bottom of an earlier one. */
function around(a: Pt, b: Pt) {
  const drop = 78 + Math.min(60, Math.abs(a.x - b.x) / 8);
  const c1 = { x: a.x, y: a.y + drop };
  const c2 = { x: b.x, y: b.y + drop };
  return { d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`, mid: { x: (a.x + b.x) / 2, y: a.y + drop * 0.75 } };
}

interface Edge {
  key: string;
  d: string;
  mid: Pt;
  tone: "go" | "back";
  /** a + goes here: the step it comes from (null = the start) and the step it goes to (null = the end) */
  from: string | null;
  to: string | null;
  label?: string;
}

/** The kinds a + offers, as the iPhone's sheet does: fewer when the chart is empty or the step goes first. */
export function kindsFor(empty: boolean, at: AddAt): AddKind[] {
  if (empty) return ["agent", "custom", "handOut"];
  if (at.between && !at.between.from.length) return ["agent", "ask", "handoff", "branch", "custom", "handOut"];
  return ADD_KINDS.map((k) => k.kind);
}

export function StepCanvas({
  team,
  selected,
  problems,
  onSelect,
  onDelete,
  onMove,
  onAdd,
  fitKey,
  empty,
  working,
}: {
  team: ChannelTeam;
  selected: string | null;
  problems: Map<string, string>;
  onSelect: (id: string | null) => void;
  /** delete a step (the right-click menu; its sheet and the Delete key do it too) */
  onDelete: (id: string) => void;
  /** a box was dragged to a new place (stored coordinates) */
  onMove: (id: string, pos: Pt) => void;
  onAdd: (kind: AddKind, at: AddAt) => void;
  /** change to fit the whole chart again (a template was used, steps were tidied) */
  fitKey: number;
  empty: ReactNode;
  /** the steps a request is working on right now: each is outlined in its agent's colour */
  working?: ReadonlySet<string>;
}) {
  const agents = useStore((s) => s.agents);
  const channels = useStore((s) => s.channels);
  const steps = team.steps ?? [];
  const el = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 60, y: 60, k: 1 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<{ id: string; pos: Pt } | null>(null);
  const [menu, setMenu] = useState<{ at: AddAt; title: string; pos: Pt } | null>(null);
  const [ctx, setCtx] = useState<{ id: string; pos: Pt } | null>(null);
  // an open menu closes on Escape (the builder's own Escape steps aside for open menus) and on a click anywhere outside it
  const menuOpen = !!(menu || ctx);
  useEffect(() => {
    if (!menuOpen) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      setCtx(null);
    };
    const away = (e: Event) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[role="menu"]')) {
        setMenu(null);
        setCtx(null);
      }
    };
    window.addEventListener("keydown", esc);
    // capture: a press on something that stops its own presses (the "A message comes in" menu) still closes this one, so only one menu is open
    window.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("keydown", esc);
      window.removeEventListener("pointerdown", away, true);
    };
  }, [menuOpen]);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ kind: "pan"; start: Pt; view: typeof view } | { kind: "move"; id: string; start: Pt; from: Pt; moved: boolean } | { kind: "pinch"; dist: number; mid: Pt; view: typeof view } | null>(null);

  const pos = useMemo(() => {
    const m = new Map<string, Pt>();
    for (const s of steps) m.set(s.id, drag?.id === s.id ? drag.pos : toCanvas(s));
    return m;
  }, [steps, drag]);

  const g = useMemo(() => stepGraph(steps), [steps]);
  const order = useMemo(() => stepOrder(steps), [steps]);
  const starts = order.filter((s) => s.kind !== "schedule" && (g.ins.get(s.id) ?? []).every((i) => stepById(team, i)?.kind === "schedule"));
  const schedules = order.filter((s) => s.kind === "schedule");
  const ends = order.filter((s) => !(g.outs.get(s.id) ?? []).length);

  // the "A message comes in" chip sits left of the first steps, level with them
  const chip = useMemo<Pt>(() => {
    if (!starts.length) return { x: 0, y: 0 };
    const xs = starts.map((s) => pos.get(s.id)!.x);
    const ys = starts.map((s) => pos.get(s.id)!.y + BOX_H / 2);
    // with a schedule in front of the first steps, the chip goes under it so the arrows stay clear
    if (schedules.length) return { x: Math.min(...schedules.map((s) => pos.get(s.id)!.x)), y: Math.max(...schedules.map((s) => pos.get(s.id)!.y)) + BOX_H + 28 };
    return { x: Math.min(...xs) - CHIP_W - 56, y: (Math.min(...ys) + Math.max(...ys)) / 2 - 20 };
  }, [starts, schedules, pos]);

  /** Who a step belongs to, for the words on an arrow back to it: its agent, you, or the team it hands to. */
  const whoOf = (id: string): string => {
    const s = stepById(team, id);
    if (!s) return "the start";
    if (s.kind === "ask") return "you";
    if (s.kind === "handoff") return channels.find((c) => c.id === s.handoffTo)?.name ?? "the other team";
    return agents.find((a) => a.id === stepAgentId(team, s))?.name ?? `step ${numberOf(team, id)}`;
  };

  const edges = useMemo(() => {
    const out: Edge[] = [];
    const right = (id: string): Pt => ({ x: pos.get(id)!.x + BOX_W, y: pos.get(id)!.y + BOX_H / 2 });
    const left = (id: string): Pt => ({ x: pos.get(id)!.x, y: pos.get(id)!.y + BOX_H / 2 });
    for (const s of starts) out.push({ key: `start>${s.id}`, ...across({ x: chip.x + CHIP_W, y: chip.y + 20 }, left(s.id)), tone: "go", from: null, to: s.id });
    for (const s of steps) {
      for (const t of g.outs.get(s.id) ?? []) {
        const label = s.kind === "branch" ? (s.ifTrue === t && s.ifFalse === t ? "Yes or no" : s.ifTrue === t ? "Yes" : s.ifFalse === t ? "No" : undefined) : undefined;
        out.push({ key: `${s.id}>${t}`, ...across(right(s.id), left(t)), tone: "go", from: s.id, to: t, label });
      }
      for (const t of g.back.get(s.id) ?? []) {
        const a = { x: pos.get(s.id)!.x + BOX_W / 2, y: pos.get(s.id)!.y + BOX_H };
        const b = { x: pos.get(t)!.x + BOX_W / 2, y: pos.get(t)!.y + BOX_H };
        out.push({ key: `${s.id}~${t}`, ...around(a, b), tone: "back", from: null, to: null, label: backLabel(s, t, whoOf(t)) });
      }
    }
    return out;
    // whoOf reads the team, agents and teams listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, g, pos, starts, chip, team, agents, channels]);

  const bounds = useCallback(() => {
    if (!steps.length) return { x: 0, y: 0, w: 400, h: 200 };
    const xs = [...steps.map((s) => pos.get(s.id)!.x), chip.x];
    const x1 = Math.max(...steps.map((s) => pos.get(s.id)!.x + BOX_W)) + 70;
    const y0 = Math.min(...steps.map((s) => pos.get(s.id)!.y)) - 30;
    const y1 = Math.max(...steps.map((s) => pos.get(s.id)!.y + BOX_H)) + (edges.some((e) => e.tone === "back") ? 130 : 40);
    const x0 = Math.min(...xs) - 20;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [steps, pos, chip, edges]);

  const fit = useCallback(() => {
    const b = bounds();
    const r = el.current?.getBoundingClientRect();
    const w = r?.width || size.w;
    const h = r?.height || size.h;
    const k = clampK(Math.min((w - 80) / b.w, (h - 80) / b.h, 1));
    setView({ k, x: (w - b.w * k) / 2 - b.x * k, y: (h - b.h * k) / 2 - b.y * k });
  }, [bounds, size]);

  useLayoutEffect(() => {
    const r = el.current?.getBoundingClientRect();
    if (r) setSize({ w: r.width, h: r.height });
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    if (el.current) ro.observe(el.current);
    return () => ro.disconnect();
  }, []);
  // fit when it first shows and when asked to (a template, tidy up)
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const zoomAt = (p: Pt, factor: number) =>
    setView((v) => {
      const k = clampK(v.k * factor);
      return { k, x: p.x - ((p.x - v.x) * k) / v.k, y: p.y - ((p.y - v.y) * k) / v.k };
    });

  // the wheel zooms around the pointer (React's wheel listener can't stop the page scrolling)
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-scroll]")) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      // a pinch (the browser sends it as a wheel with Ctrl) and a mouse's wheel zoom; two fingers on a trackpad move the chart
      if (e.ctrlKey || e.metaKey) zoomAt(p, Math.exp(-e.deltaY * 0.01));
      else if (e.deltaMode !== 0) zoomAt(p, Math.exp(-e.deltaY * 0.05));
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = el.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-ui]")) return;
    if (e.isPrimary) pointers.current.clear();
    el.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    setMenu(null);
    setCtx(null);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view };
      return;
    }
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-step]")?.dataset.step;
    if (id) gesture.current = { kind: "move", id, start: local(e), from: pos.get(id)!, moved: false };
    else gesture.current = { kind: "pan", start: local(e), view };
  };
  const moveP = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const gst = gesture.current;
    if (!gst) return;
    if (gst.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const k = clampK((gst.view.k * Math.hypot(a.x - b.x, a.y - b.y)) / gst.dist);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setView({ k, x: mid.x - ((gst.mid.x - gst.view.x) * k) / gst.view.k, y: mid.y - ((gst.mid.y - gst.view.y) * k) / gst.view.k });
    } else if (gst.kind === "pan") setView({ ...gst.view, x: gst.view.x + p.x - gst.start.x, y: gst.view.y + p.y - gst.start.y });
    else if (gst.kind === "move") {
      const dx = (p.x - gst.start.x) / view.k;
      const dy = (p.y - gst.start.y) / view.k;
      if (!gst.moved && Math.hypot(dx, dy) < 4) return;
      gst.moved = true;
      setDrag({ id: gst.id, pos: { x: Math.round((gst.from.x + dx) / 8) * 8, y: Math.round((gst.from.y + dy) / 8) * 8 } });
    }
  };
  const up = (e: ReactPointerEvent) => {
    const gst = gesture.current;
    pointers.current.delete(e.pointerId);
    if (gst?.kind === "move") {
      if (!gst.moved) onSelect(gst.id);
      else if (drag) onMove(drag.id, fromCanvas(drag.pos));
      setDrag(null);
    }
    if (gst?.kind === "pan" && Math.hypot(local(e).x - gst.start.x, local(e).y - gst.start.y) < 4) onSelect(null);
    gesture.current = null;
  };

  // a step that was just picked or added comes into view
  useEffect(() => {
    if (!selected) return;
    const at = pos.get(selected);
    if (!at) return;
    setView((v) => {
      const m = 24;
      const left = at.x * v.k + v.x;
      const right = (at.x + BOX_W) * v.k + v.x;
      const top = at.y * v.k + v.y;
      const bottom = (at.y + BOX_H) * v.k + v.y;
      let dx = 0;
      let dy = 0;
      if (right > size.w - m) dx = size.w - m - right;
      if (left + dx < m) dx = m - left;
      if (bottom > size.h - m) dy = size.h - m - bottom;
      if (top + dy < m) dy = m - top;
      return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
    });
    // only when the pick changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const toScreen = (p: Pt): Pt => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y });
  const openMenu = (at: AddAt, title: string, world: Pt) => setMenu({ at, title, pos: toScreen(world) });
  const nameOf = (id: string | null) => (id ? titleOf(stepById(team, id) ?? { action: "" }) : "");
  const menuKinds = menu ? kindsFor(steps.length === 0, menu.at) : [];
  const unscale = Math.min(2, 1 / view.k);

  return (
    <div ref={el} className="absolute inset-0 touch-none select-none overflow-hidden" style={{ backgroundColor: "var(--panel)", backgroundImage: "radial-gradient(color-mix(in oklab, var(--ink) 12%, transparent) 1.2px, transparent 1.3px)", backgroundSize: `${22 * view.k}px ${22 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }} onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} onDoubleClick={(e) => {
        // double-click the background: the whole chart fits again
        if (!(e.target as HTMLElement).closest("[data-step], [data-ui]")) fit();
      }} onContextMenu={(e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>("[data-step]")?.dataset.step;
        if (!id) return;
        e.preventDefault();
        onSelect(id);
        setMenu(null);
        setCtx({ id, pos: local(e) });
      }} aria-label="Steps chart" role="application">
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0, width: 1, height: 1 }} aria-hidden>
          <defs>
            {(["go", "back"] as const).map((t) => (
              <marker key={t} id={`flow-arrow-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={t === "back" ? "fill-warn" : "fill-faint"} />
              </marker>
            ))}
          </defs>
          {edges.map((l) => (
            <path key={l.key} d={l.d} fill="none" strokeWidth={2} markerEnd={`url(#flow-arrow-${l.tone})`} strokeDasharray={l.tone === "back" ? "6 5" : undefined} className={l.tone === "back" ? "stroke-warn" : "stroke-faint"} />
          ))}
        </svg>

        {steps.length > 0 && (
          <div className="absolute" style={{ left: chip.x, top: chip.y }}>
            <MessageChip onSchedule={() => onAdd("schedule", {})} />
          </div>
        )}

        {edges
          .filter((l) => l.label)
          .map((l) => (
            <span key={`${l.key}:label`} className={cx("pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[8px] border px-3 py-1 text-[12px]", l.tone === "back" ? "border-line bg-card text-muted" : "border-line bg-panel text-muted")} style={{ left: l.mid.x, top: l.mid.y + (l.tone === "go" ? -16 : 0) }}>
              {l.label}
            </span>
          ))}

        {steps.map((s) => (
          <Box key={s.id} step={s} team={team} at={pos.get(s.id)!} selected={selected === s.id} problem={problems.get(s.id)} dragging={drag?.id === s.id} working={!!working?.has(s.id)} agents={agents} onKey={() => onSelect(s.id)} />
        ))}

        {/* a + on every arrow (it shows when the arrow is pointed at), and one after the last steps */}
        {edges
          .filter((l) => l.tone === "go")
          .map((l) => (
            <button
              key={`${l.key}:plus`}
              type="button"
              data-ui
              aria-label={l.from ? `Add a step between ${nameOf(l.from)} and ${nameOf(l.to)}` : `Add a step before ${nameOf(l.to)}`}
              onClick={() => openMenu({ between: { from: l.from ? [l.from] : [], to: l.to ? [l.to] : [] } }, l.from ? `Add between ${nameOf(l.from)} and ${nameOf(l.to)}` : `Add before ${nameOf(l.to)}`, l.mid)}
              className="absolute grid size-8 place-items-center rounded-full opacity-0 outline-none hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              style={{ left: l.mid.x - 16, top: l.mid.y - 16, transform: `scale(${unscale})` }}
            >
              <span className="grid size-6 place-items-center rounded-full bg-accent text-accent-ink">
                <Plus size={13} strokeWidth={2.4} />
              </span>
            </button>
          ))}
        {ends.map((s) => {
          const p = pos.get(s.id)!;
          return (
            <button key={`${s.id}:tail`} type="button" data-ui aria-label={`Add a step after ${titleOf(s)}`} onClick={() => openMenu({ after: s.id }, `Add after ${titleOf(s)}`, { x: p.x + BOX_W + 28, y: p.y + BOX_H / 2 })} className="absolute grid size-8 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ left: p.x + BOX_W + 10, top: p.y + BOX_H / 2 - 16, transform: `scale(${unscale})`, transformOrigin: "left center" }}>
              <span className="grid size-6 place-items-center rounded-full bg-accent text-accent-ink">
                <Plus size={13} strokeWidth={2.4} />
              </span>
            </button>
          );
        })}
      </div>

      {ctx && (
        <div data-ui role="menu" aria-label="Step actions" className="absolute z-20 w-[180px] rounded-2xl border border-line bg-card p-1.5 shadow-panel" style={{ left: Math.max(8, Math.min(size.w - 188, ctx.pos.x)), top: Math.max(8, Math.min(size.h - 56, ctx.pos.y)) }}>
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              const id = ctx.id;
              setCtx(null);
              onDelete(id);
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-body text-bad hover:bg-hover"
          >
            <Trash2 size={15} aria-hidden /> Delete step
          </button>
        </div>
      )}

      {menu && (
        <div data-ui data-scroll role="menu" aria-label={menu.title} className="absolute z-20 w-[230px] overflow-y-auto rounded-[12px] border border-line bg-card p-1.5 shadow-panel" style={{ left: Math.max(8, Math.min(size.w - 238, menu.pos.x + 12)), top: Math.max(8, Math.min(size.h - (menuKinds.length * 36 + 12) - 8, menu.pos.y - 24)), maxHeight: size.h - 16 }}>
          {ADD_KINDS.filter((k) => menuKinds.includes(k.kind)).map((k) => (
            <button
              key={k.kind}
              type="button"
              role="menuitem"
              title={k.blurb}
              onClick={() => {
                setMenu(null);
                onAdd(k.kind, menu.at);
              }}
              className="flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[14px] hover:bg-hover"
            >
              <span className="shrink-0 text-muted">
                <KindIcon kind={k.kind === "agent" ? "do" : k.kind === "handOut" ? "hand_out" : k.kind === "beside" ? "beside" : k.kind} size={16} />
              </span>
              <span className="min-w-0 truncate">{k.title}</span>
            </button>
          ))}
        </div>
      )}

      {empty}
    </div>
  );
}

/** One step on the chart: whose it is (the agent's ghost and name) and what it does in a few words. */
function Box({ step, team, at, selected, problem, dragging, working, agents, onKey }: { step: TeamStep; team: ChannelTeam; at: Pt; selected: boolean; problem?: string; dragging: boolean; working: boolean; agents: ReturnType<typeof useStore.getState>["agents"]; onKey: () => void }) {
  const agent = agents.find((a) => a.id === stepAgentId(team, step));
  const handoff = useHandoffName(step.handoffTo);
  const n = numberOf(team, step.id);
  const plain = step.kind === "schedule" || step.kind === "ask" || step.kind === "handoff";
  const who = step.kind === "schedule" ? "Schedule" : step.kind === "ask" ? "You" : step.kind === "handoff" ? handoff : agent?.name;
  const words = step.kind === "schedule" ? (step.enabled === false ? "Off" : whenText(step)) : cardSentence(step);
  const mark = KIND_MARK[step.kind];
  return (
    <div
      data-step={step.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${step.kind === "schedule" ? `Schedule, ${whenText(step)}` : `Step ${n}, ${titleOf(step)}`}${working ? ", working now" : ""}${problem ? `. ${problem}` : ""}`}
      title={problem ?? (step.kind === "schedule" ? (nextText(step) ?? undefined) : undefined)}
      onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onKey())}
      className={cx("absolute cursor-grab rounded-[12px] border bg-card p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", dragging && "cursor-grabbing shadow-panel", problem ? "border-bad/50" : "border-line", selected && "ring-2 ring-ink/20", working && "border-[1.5px]")}
      style={{ left: at.x, top: at.y, width: BOX_W, height: BOX_H, ...(working ? { borderColor: agent ? agentColor(agent) : "var(--st-working)" } : {}) }}
    >
      <div className="flex items-center gap-2">
        {plain ? (
          <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-chip text-muted" aria-hidden>
            {step.kind === "schedule" ? <Clock size={14} strokeWidth={1.8} /> : step.kind === "ask" ? <UserCheck size={14} strokeWidth={1.8} /> : <Share2 size={14} strokeWidth={1.8} />}
          </span>
        ) : agent ? (
          <AgentAvatar agent={agent} size={26} live={working} interactive={false} />
        ) : (
          <span className="size-[26px] shrink-0 rounded-full border border-dashed border-bad/60" aria-hidden />
        )}
        <span className={cx("min-w-0 flex-1 truncate text-[14px] font-semibold", !who && "text-bad")}>{who ?? "Pick an agent"}</span>
        {mark && !plain && (
          <span className="shrink-0 text-faint" title={mark}>
            <KindIcon kind={step.kind} size={14} />
          </span>
        )}
      </div>
      <div className={cx("mt-1.5 line-clamp-2 text-[13px] leading-[18px]", working ? "animate-pulse text-ink motion-reduce:animate-none" : "text-muted")}>{words}</div>
    </div>
  );
}
