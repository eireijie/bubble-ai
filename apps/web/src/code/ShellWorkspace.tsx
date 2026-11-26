import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Columns2, Maximize2, Minimize2, Play, Plus, Rows2, SquareTerminal, X } from "lucide-react";
import { BarMenu, CodeBar, TERMINAL_BLOCK, type BarItems } from "./Bar.tsx";
import { HARNESSES } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { href } from "../router.ts";
import { Menu, cx } from "../components/ui.tsx";
import { TerminalPane, type ShellTarget } from "../components/TerminalPane.tsx";
import { uuid } from "../uuid.ts";
import { useFeatures } from "../features.ts";
import { MAX_PANES, MAX_TABS, allLeaves, layout, leaves, neighbor, newSession, removePane, restore, setRatio, splitPane, type Leaf, type Tab, type Workspace } from "./layout.ts";

/**
 * Code's terminal workspace, working like tmux. Tabs, each split into
 * panes side by side or stacked, with dividers you drag; a pane is a shell on one of your
 * computers, or an agent harness's CLI. ⌃B then a key does what tmux's prefix does. On screen it
 * is one slim row (what's open, the computer, Split and New shell) over the terminals; tabs show
 * only once there is a second one. The layout
 * is remembered on this browser and the shells keep running on the computer, so a reload, a
 * dropped connection or another tab picks up the same shells.
 */

/** the layout, one per Bubble AI workspace (its computers are that workspace's) */
const STORE = "wisp.code.workspace";
/** before tabs: a flat list of panes */
const OLD_STORE = "wisp.code.panes";

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

const harnessLabel = (id?: string) => HARNESSES.find((h) => h.id === id)?.label;

type Move = "left" | "right" | "up" | "down";

/** narrower or shorter than this, a shell's prompt wraps: a split that would make one goes to a new tab */
const MIN_W = 240;
const MIN_H = 110;

/** what a shifted key types on a US keyboard, for events that report the unshifted key */
const SHIFTED: Record<string, string> = { "'": '"', "5": "%", "7": "&", "\\": "|" };

/** `lead`: what the row starts with (Code's pill). `note`: something that went wrong, said in the row. */
export function ShellWorkspace(props: { lead?: ReactNode; note?: string | null }) {
  const workspaceId = useStore((s) => s.me?.workspace.id) ?? "none";
  // a workspace of its own each, started afresh when you switch
  return <Shells key={workspaceId} store={`${STORE}:${workspaceId}`} {...props} />;
}

function Shells({ lead, note, store }: { lead?: ReactNode; note?: string | null; store: string }) {
  const on = useFeatures().code;
  const [targets, setTargets] = useState<ShellTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the layout saved before layouts were kept per workspace is taken once, by the first one opened
  const [ws, setWs] = useState<Workspace>(() => restore(read(store) ?? read(STORE), read(OLD_STORE), () => uuid()));
  const [notice, setNotice] = useState<string | null>(null);
  const pruned = useRef(false);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const layers = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    let gone = false;
    const refresh = () =>
      api<ShellTarget[]>("GET", "/api/terminals").then(
        (t) => {
          if (gone) return;
          setTargets(t);
          setError(null);
          // panes on computers that aren't yours to open any more (removed, another workspace's) go, once on load
          if (pruned.current) return;
          pruned.current = true;
          const ids = new Set(t.map((x) => x.id));
          setWs((w) => {
            let next = w;
            for (const l of allLeaves(w)) if (!ids.has(l.computerId)) next = dropPane(next, l.key);
            return next;
          });
        },
        (err) => !gone && setError((err as Error).message),
      );
    void refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const r = () => setNarrow(window.innerWidth < 768);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(store, JSON.stringify(ws));
      localStorage.removeItem(STORE);
      localStorage.removeItem(OLD_STORE);
    } catch {}
  }, [ws, store]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const tab = ws.tabs.find((t) => t.id === ws.active) ?? ws.tabs[0];
  const changeTab = useCallback((id: string, fn: (t: Tab) => Tab) => setWs((w) => ({ ...w, tabs: w.tabs.map((t) => (t.id === id ? fn(t) : t)) })), []);
  const targetOf = (computerId: string) => targets?.find((t) => t.id === computerId);
  /** where a new pane goes when you don't pick: the focused pane's computer, else the first one online */
  const defaultTarget = () => {
    const focused = leaves(tab.root).find((l) => l.key === tab.focus);
    return (focused && targetOf(focused.computerId)) ?? targets?.find((t) => t.online) ?? targets?.[0];
  };

  const leafFor = (target: ShellTarget, launch?: string): Leaf => ({
    kind: "pane",
    key: uuid(),
    computerId: target.id,
    session: newSession(launch ?? target.name, target.id, allLeaves(ws)),
    ...(launch ? { launch } : {}),
  });

  /** would splitting the focused pane leave both halves big enough for a prompt? */
  const roomFor = (dir: "row" | "col") => {
    const box = layers.current.get(tab.id)?.getBoundingClientRect();
    const r = layout(tab.root).panes.find((p) => p.leaf.key === tab.focus)?.rect;
    if (narrow || !box || !r || !box.width) return true;
    return dir === "row" ? (r.w * box.width) / 2 >= MIN_W : (r.h * box.height) / 2 >= MIN_H;
  };

  const addPane = (target: ShellTarget | undefined, dir: "row" | "col" = "row", launch?: string) => {
    if (!target) return;
    if (tab.root && (leaves(tab.root).length >= MAX_PANES || !roomFor(dir))) {
      if (ws.tabs.length >= MAX_TABS) return setNotice("No room for another pane. Close one first.");
      setNotice("No room for another pane here, so it opened in a new tab.");
      return newTab(target, launch);
    }
    const leaf = leafFor(target, launch);
    changeTab(tab.id, (t) => ({ ...t, root: splitPane(t.root, t.focus ?? "", dir, leaf), focus: leaf.key, zoom: false }));
  };

  /** what to do when a harness's CLI can't start on a computer: open it where it's signed in, or sign in here */
  const fixesFor = (target: ShellTarget, launch: string) => {
    const name = harnessLabel(launch) ?? launch;
    const fixes: { label: string; onClick: () => void }[] = [];
    const devices = targets?.filter((t) => t.id !== target.id && t.online && t.kind === "device") ?? [];
    const other = devices.find((t) => /^this (mac|computer|pc)$/i.test(t.name)) ?? devices[0];
    if (other) fixes.push({ label: `Open ${name} on ${other.name}`, onClick: () => addPane(other, "row", launch) });
    fixes.push({ label: "Open a shell here to sign in", onClick: () => addPane(target, "row") });
    return fixes;
  };

  const newTab = (target: ShellTarget | undefined = defaultTarget(), launch?: string) => {
    if (!target || ws.tabs.length >= MAX_TABS) return;
    const leaf = leafFor(target, launch);
    const t: Tab = { id: uuid(), root: leaf, focus: leaf.key };
    setWs((w) => ({ tabs: [...w.tabs, t], active: t.id }));
  };

  const closePane = (key: string) => setWs((w) => dropPane(w, key));

  const closeTab = (id: string) =>
    setWs((w) => {
      if (w.tabs.length === 1) return { ...w, tabs: [{ ...w.tabs[0], root: null, focus: null, zoom: false }] };
      const i = w.tabs.findIndex((t) => t.id === id);
      const tabs = w.tabs.filter((t) => t.id !== id);
      return { tabs, active: w.active === id ? tabs[Math.max(0, i - 1)].id : w.active };
    });

  const move = (dir: Move) => {
    const next = tab.focus && neighbor(tab.root, tab.focus, dir);
    if (next) changeTab(tab.id, (t) => ({ ...t, focus: next, zoom: false }));
  };
  const cycle = (step: number) => {
    const keys = leaves(tab.root).map((l) => l.key);
    if (keys.length < 2) return;
    const i = keys.indexOf(tab.focus ?? "");
    changeTab(tab.id, (t) => ({ ...t, focus: keys[(i + step + keys.length) % keys.length] }));
  };
  const switchTab = (i: number) => {
    const t = ws.tabs[(i + ws.tabs.length) % ws.tabs.length];
    if (t) setWs((w) => ({ ...w, active: t.id }));
  };
  const zoom = () => changeTab(tab.id, (t) => ({ ...t, zoom: !t.zoom }));

  // the keys, like tmux: ⌃B then one key. ⌘D and ⌘⇧D split straight away.
  const act = useRef<(key: string) => void>(() => {});
  act.current = (k) => {
    if (k === "%" || k === "|") addPane(defaultTarget(), "row");
    else if (k === '"' || k === "-") addPane(defaultTarget(), "col");
    else if (k === "ArrowLeft" || k === "h") move("left");
    else if (k === "ArrowRight" || k === "l") move("right");
    else if (k === "ArrowUp" || k === "k") move("up");
    else if (k === "ArrowDown" || k === "j") move("down");
    else if (k === "o") cycle(1);
    else if (k === "x" && tab.focus) closePane(tab.focus);
    else if (k === "&") closeTab(tab.id);
    else if (k === "z") zoom();
    else if (k === "c") newTab();
    else if (k === "n") switchTab(ws.tabs.indexOf(tab) + 1);
    else if (k === "p") switchTab(ws.tabs.indexOf(tab) - 1);
    else if (/^[1-9]$/.test(k)) switchTab(Number(k) - 1);
  };
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = false;
    const disarm = () => {
      waiting = false;
      clearTimeout(timer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        e.stopPropagation();
        waiting = true;
        clearTimeout(timer);
        timer = setTimeout(disarm, 4000);
        return;
      }
      if (waiting) {
        if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        // by the physical key too, so % and " work whatever the keyboard layout reports
        const key = (e.shiftKey && SHIFTED[e.key]) || e.key;
        if (key !== "Escape") act.current(key);
        return disarm();
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        e.stopPropagation();
        act.current(e.shiftKey ? '"' : "%");
      }
    };
    // capture: before the terminal takes the key
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
    };
  }, [on]);

  // dragging a divider: its split's ratio follows the pointer
  const drag = (e: ReactPointerEvent<HTMLDivElement>, tabId: string, d: ReturnType<typeof layout>["dividers"][number]) => {
    const layer = layers.current.get(tabId);
    if (!layer) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const box = layer.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const at = d.dir === "row" ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      const ratio = d.dir === "row" ? (at - d.rect.x) / d.rect.w : (at - d.rect.y) / d.rect.h;
      changeTab(tabId, (t) => ({ ...t, root: setRatio(t.root, d.path, ratio) }));
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  const tabName = (t: Tab) => {
    const l = leaves(t.root).find((x) => x.key === t.focus) ?? leaves(t.root)[0];
    return l ? (harnessLabel(l.launch) ?? l.session) : "empty";
  };

  const btn = "inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-[12.5px] transition-[background-color,transform] active:scale-[.96] disabled:opacity-40";
  const term = <SquareTerminal size={15} strokeWidth={1.8} />;

  /** the empty workspace's one button: a shell on a computer you pick */
  const firstShell =
    targets && targets.length > 0 ? (
      <Menu
        align="right"
        trigger={(_, toggle) => (
          <button type="button" onClick={toggle} className={cx(btn, "border-[#f2f2f4] bg-[#f2f2f4] font-semibold text-[#0c0c0e] hover:bg-white")}>
            <Plus size={14} strokeWidth={2} />
            New shell
          </button>
        )}
        items={targets.map((t) => ({ label: t.online ? t.name : `${t.name} (offline)`, icon: term, onSelect: () => addPane(t) }))}
      />
    ) : null;

  // Split's menu: the two splits, zoom, and a new tab (their keys still work: ⌃B % " z c, ⌘D, ⌘⇧D)
  const splitItems: BarItems = [
    { label: "Split side by side", icon: <Columns2 size={16} strokeWidth={1.8} />, onSelect: () => addPane(defaultTarget(), "row") },
    { label: "Split stacked", icon: <Rows2 size={16} strokeWidth={1.8} />, onSelect: () => addPane(defaultTarget(), "col") },
    ...(!narrow && leaves(tab.root).length > 1 ? [{ label: tab.zoom ? "Show all panes" : "Zoom the pane", icon: tab.zoom ? <Minimize2 size={15} strokeWidth={1.9} /> : <Maximize2 size={15} strokeWidth={1.9} />, onSelect: zoom }] : []),
    ...(ws.tabs.length < MAX_TABS ? [{ label: "New tab", icon: <Plus size={16} strokeWidth={2} />, onSelect: () => newTab() }] : []),
  ];
  // New shell's menu: a shell on one of your computers, or an agent's CLI in a pane
  const shellItems: BarItems = [
    ...(targets ?? []).map((t) => ({ label: t.online ? t.name : `${t.name} (offline)`, icon: term, onSelect: () => addPane(t) })),
    "divider",
    ...HARNESSES.map((h) => ({ label: `Run ${h.label}`, icon: <Play size={15} strokeWidth={1.9} />, onSelect: () => addPane(defaultTarget(), "row", h.id) })),
  ];
  const focusedLeaf = leaves(tab.root).find((l) => l.key === tab.focus);
  const panesHere = leaves(tab.root).length;
  // tabs, the phone's pane arrows and a passing notice share one thin row, shown only when one of them has something to show
  const strip = ws.tabs.length > 1 || (narrow && panesHere > 1) || !!notice;

  const hasPanes = ws.tabs.some((t) => t.root);

  return (
    <div className="flex h-full min-h-0 flex-col pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-4">
      <CodeBar lead={lead} computer={focusedLeaf ? targetOf(focusedLeaf.computerId)?.name : null} note={note}>
        {on && tab.root && <BarMenu icon={<Columns2 size={17} strokeWidth={1.8} />} label="Split" items={splitItems} />}
        {on && targets && targets.length > 0 && <BarMenu icon={<SquareTerminal size={17} strokeWidth={1.8} />} label="New shell" items={shellItems} />}
      </CodeBar>

      <div className={TERMINAL_BLOCK}>
      <main className="relative min-h-0 flex-1 overflow-hidden">
        {on &&
          targets &&
          ws.tabs.map((t) => {
            const { panes, dividers } = layout(t.root);
            const zoomed = narrow || !!t.zoom;
            const shown = t.id === tab.id;
            return (
              <div
                key={t.id}
                ref={(el) => void (el ? layers.current.set(t.id, el) : layers.current.delete(t.id))}
                // other tabs stay put (hidden), so their shells stay connected
                className={cx("absolute inset-x-1.5 inset-y-0", !shown && "invisible pointer-events-none")}
                aria-hidden={!shown}
              >
                {panes.map(({ leaf, rect }) => {
                  const target = targetOf(leaf.computerId);
                  const focused = t.focus === leaf.key;
                  const hide = zoomed && !focused;
                  const style: CSSProperties = zoomed ? { left: 0, top: 0, width: "100%", height: "100%" } : { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` };
                  return (
                    <div key={leaf.key} style={style} className={cx("absolute grid p-[3px]", hide && "invisible")}>
                      {target ? (
                        <TerminalPane
                          bare={panes.length === 1}
                          target={target}
                          session={leaf.session}
                          launch={leaf.launch}
                          label={leaf.launch ? `${harnessLabel(leaf.launch)} · ${leaf.session}` : undefined}
                          focused={shown && focused}
                          onFocus={() => (t.focus === leaf.key ? undefined : changeTab(t.id, (x) => ({ ...x, focus: leaf.key })))}
                          onClose={() => closePane(leaf.key)}
                          fixes={leaf.launch ? fixesFor(target, leaf.launch) : undefined}
                        />
                      ) : (
                        <Gone onClose={() => closePane(leaf.key)} />
                      )}
                    </div>
                  );
                })}
                {!zoomed &&
                  dividers.map((d) => {
                    const style: CSSProperties =
                      d.dir === "row"
                        ? // kept off its ends, so where dividers meet each one can still be grabbed
                          { left: `calc(${d.at * 100}% - 4px)`, top: `calc(${d.rect.y * 100}% + 8px)`, width: 8, height: `calc(${d.rect.h * 100}% - 16px)` }
                        : { top: `calc(${d.at * 100}% - 4px)`, left: `calc(${d.rect.x * 100}% + 8px)`, height: 8, width: `calc(${d.rect.w * 100}% - 16px)` };
                    return (
                      <div
                        key={d.path.join(".") || "root"}
                        role="separator"
                        aria-orientation={d.dir === "row" ? "vertical" : "horizontal"}
                        onPointerDown={(e) => drag(e, t.id, d)}
                        onDoubleClick={() => changeTab(t.id, (x) => ({ ...x, root: setRatio(x.root, d.path, 0.5) }))}
                        style={style}
                        className={cx("group absolute z-10 touch-none", d.dir === "row" ? "cursor-col-resize" : "cursor-row-resize")}
                      >
                        <span className={cx("absolute rounded-full bg-white/0 transition-colors duration-150 group-hover:bg-white/25 group-active:bg-[#6aa2ff]", d.dir === "row" ? "inset-y-2 left-[3.5px] w-px" : "inset-x-2 top-[3.5px] h-px")} />
                      </div>
                    );
                  })}
              </div>
            );
          })}

        {(!on || !targets || !tab.root) && (
          <div className="absolute inset-0 grid place-items-center px-6 pb-16 text-center">
            <div className="flex max-w-[320px] flex-col items-center gap-3 m-fade-in">
              <SquareTerminal size={22} strokeWidth={1.6} className="text-[#8e8e96]" />
              {!on ? (
                <>
                  <p className="text-[13px] text-[#a1a1aa]">Code is turned off.</p>
                  <a href={href({ view: "mods" })} className="text-[12.5px] text-[#6aa2ff] hover:text-[#9cc2ff]">
                    Mods
                  </a>
                </>
              ) : targets === null ? (
                <p className="text-[12.5px] text-[#8e8e96]">{error ?? "Loading…"}</p>
              ) : targets.length === 0 ? (
                <>
                  <p className="text-[13px] text-[#a1a1aa]">No computers of yours to open a terminal on.</p>
                  <a href={href({ view: "computers", computerId: null })} className="text-[12.5px] text-[#6aa2ff] hover:text-[#9cc2ff]">
                    Computers
                  </a>
                </>
              ) : (
                firstShell
              )}
            </div>
          </div>
        )}
      </main>

      {on && targets && hasPanes && strip && (
        <footer className="flex h-8 shrink-0 items-center gap-1 overflow-hidden px-3 font-mono text-[11.5px]">
          {ws.tabs.length > 1 &&
            ws.tabs.map((t, i) => (
              <span key={t.id} className={cx("group inline-flex h-[22px] max-w-[180px] items-center rounded-[5px] transition-colors", t.id === tab.id ? "bg-[#26262b] text-[#f2f2f4]" : "text-[#8e8e96] hover:bg-white/[.05] hover:text-[#d4d4d8]")}>
                <button type="button" onClick={() => setWs((w) => ({ ...w, active: t.id }))} className="truncate px-2" title={`Tab ${i + 1} (⌃B ${i + 1})`}>
                  {i + 1}:{tabName(t)}
                </button>
                <button type="button" onClick={() => closeTab(t.id)} aria-label={`Close tab ${i + 1}`} title="Close tab (⌃B &)" className={cx("-ml-1 mr-0.5 h-4 w-4 place-items-center rounded text-[#8e8e96] hover:text-[#f2f2f4] focus-visible:grid group-hover:grid", t.id === tab.id ? "grid" : "hidden")}>
                  <X size={11} strokeWidth={2.2} />
                </button>
              </span>
            ))}
          <span className="flex-1" />
          {narrow && panesHere > 1 && (
            <span className="flex items-center gap-1 text-[#a1a1aa]">
              <button type="button" onClick={() => cycle(-1)} className="px-1.5" aria-label="Previous pane">
                ‹
              </button>
              {leaves(tab.root).findIndex((l) => l.key === tab.focus) + 1}/{panesHere}
              <button type="button" onClick={() => cycle(1)} className="px-1.5" aria-label="Next pane">
                ›
              </button>
            </span>
          )}
          {notice && (
            <span role="status" className="m-fade-in truncate text-[#a1a1aa]">
              {notice}
            </span>
          )}
        </footer>
      )}
      </div>
    </div>
  );
}

/** A pane whose computer you can't open a terminal on any more (removed, or Code access changed). */
function Gone({ onClose }: { onClose: () => void }) {
  return (
    <div className="grid place-items-center rounded-[10px] border border-white/[.08] bg-[#0c0c0e] px-6 text-center text-[12.5px] text-[#8e8e96]">
      <div className="flex flex-col items-center gap-2.5">
        <span>This computer isn't available for terminals any more.</span>
        <button type="button" onClick={onClose} className="inline-flex h-7 items-center rounded-md border border-white/[.09] bg-[#1d1d21] px-2.5 text-[#f2f2f4] hover:bg-[#26262b]">
          Close pane
        </button>
      </div>
    </div>
  );
}

/** The workspace without the pane `key`: its sibling takes the room, and an emptied tab goes unless it's the last. */
function dropPane(w: Workspace, key: string): Workspace {
  const owner = w.tabs.find((t) => leaves(t.root).some((l) => l.key === key));
  if (!owner) return w;
  const root = removePane(owner.root, key);
  if (!root && w.tabs.length > 1) {
    const tabs = w.tabs.filter((t) => t.id !== owner.id);
    const i = w.tabs.indexOf(owner);
    return { tabs, active: w.active === owner.id ? tabs[Math.max(0, i - 1)].id : w.active };
  }
  const keys = leaves(root).map((l) => l.key);
  const focus = owner.focus && keys.includes(owner.focus) ? owner.focus : (keys.at(-1) ?? null);
  return { ...w, tabs: w.tabs.map((t) => (t.id === owner.id ? { ...t, root, focus, zoom: t.zoom && keys.length > 1 } : t)) };
}
