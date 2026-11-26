import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Columns2, ListTodo, Maximize2, MessageSquare, Plus, Square, SquareTerminal } from "lucide-react";
import { api } from "../api.ts";
import { go, href } from "../router.ts";
import { agentColor } from "../components/ui.tsx";
import { TerminalPane, type ShellTarget } from "../components/TerminalPane.tsx";
import { uuid } from "../uuid.ts";
import { ShellWorkspace } from "../code/ShellWorkspace.tsx";
import { useFeatures } from "../features.ts";
import { useStore } from "../store.ts";
import { AgentPane, GhostIcon, STATE_COLOR, TalkBar } from "../code/AgentPane.tsx";
import { BarMenu, CodeBar, Switcher, TERMINAL_BLOCK, type BarItems } from "../code/Bar.tsx";
import { NewTaskSheet } from "../code/NewTaskSheet.tsx";
import { Palette, type PaletteItem } from "../code/Palette.tsx";
import { branchesOf, type ReviewTab } from "../code/ReviewPanel.tsx";
import { groupTasks, repoName, uniqueLabels, useCodeTasks } from "../code/data.ts";
import { requestTask } from "./task-lanes.ts";

/**
 * Code (a mod, on by default): a terminal workspace for coding tasks, in the spirit of tmux.
 * Almost all of it is terminal. One slim row sits over it: a pill with the agent in focus (its
 * menu switches between a task's panes, the coding tasks and plain Shells, like tmux's sessions),
 * the computer's name, and two icon buttons, Split (the layouts) and New shell. A task's panes are
 * its agents, each drawn as its own terminal, plus shells you open beside them; the composer under
 * them talks to the agent in focus. Review is on the task's page. What's open is remembered on
 * this browser.
 */

interface Shell {
  key: string;
  computerId: string;
  session: string;
}

type Layout = "main" | "cols" | "zoom";
const SHELLS = "shells";
/** at most this many shells per task (or in Shells), so it never gets crowded */
const MAX_SHELLS = 4;

function load<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

/** A shell name nobody else's pane on that computer uses: a stem and a number. */
function newSession(stem: string, computerId: string, all: Shell[]) {
  const s = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-")[0] || "shell";
  const taken = new Set(all.filter((p) => p.computerId === computerId).map((p) => p.session));
  let n = 1;
  while (taken.has(`${s}-${n}`)) n++;
  return `${s}-${n}`;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl ";

export function CodeView() {
  const on = useFeatures().code;
  const agents = useStore((s) => s.agents);
  const computers = useStore((s) => s.computers);
  const { tasks, error } = useCodeTasks();
  const [targets, setTargets] = useState<ShellTarget[] | null>(null);
  const [selected, setSelected] = useState<string>(() => load("wisp.code.task", SHELLS));
  // shells opened beside a task's agents; Shells itself is the tmux-style workspace (ShellWorkspace), stored on its own
  const [shells, setShells] = useState<Record<string, Shell[]>>(() => {
    const { [SHELLS]: _plain, ...rest } = load<Record<string, Shell[]>>("wisp.code.shells", {});
    return rest;
  });
  const [focus, setFocus] = useState<Record<string, string>>(() => load("wisp.code.focus", {}));
  const [layout, setLayout] = useState<Layout>(() => load("wisp.code.layout", "main"));
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);
  // each goes up to open a menu, or put the cursor in the composer, from a key
  const [picker, setPicker] = useState(0);
  const [switcher, setSwitcher] = useState(0);
  const [talk, setTalk] = useState(0);

  useEffect(() => {
    const r = () => setNarrow(window.innerWidth < 768);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  useEffect(() => {
    let gone = false;
    const refresh = () => api<ShellTarget[]>("GET", "/api/terminals").then((t) => !gone && setTargets(t), () => {});
    void refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, []);

  // whose keyboard is taken (then kept current by the hub's events)
  useEffect(() => {
    api<Record<string, string>>("GET", "/api/keyboard").then((keyboard) => useStore.setState({ keyboard }), () => {});
  }, []);

  useEffect(() => save("wisp.code.task", selected), [selected]);
  useEffect(() => {
    save("wisp.code.shells", shells);
  }, [shells]);
  useEffect(() => save("wisp.code.focus", focus), [focus]);
  useEffect(() => save("wisp.code.layout", layout), [layout]);

  const task = tasks?.find((t) => t.root.id === selected) ?? null;
  // a task that's gone (deleted, or Code lost access) falls back to Shells
  useEffect(() => {
    if (tasks && selected !== SHELLS && !task) setSelected(SHELLS);
  }, [tasks, selected, task]);

  const allShells = useMemo(() => Object.values(shells).flat(), [shells]);
  const myShells = (shells[selected] ?? []).flatMap((s) => {
    const target = targets?.find((t) => t.id === s.computerId);
    return target ? [{ ...s, target }] : [];
  });

  // the panes, in order: a task's agents, then its shells
  const taskAgents = task ? task.agentIds.map((id) => agents.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a) : [];
  const paneIds = [...taskAgents.map((a) => a.id), ...myShells.map((s) => s.key)];
  const focused = paneIds.includes(focus[selected] ?? "") ? focus[selected]! : (paneIds[0] ?? null);
  const setFocused = useCallback((id: string) => setFocus((f) => ({ ...f, [selected]: id })), [selected]);
  const effLayout: Layout = narrow ? "zoom" : layout;
  // who the pill shows and the composer talks to: the agent in focus, else the task's first
  const talkAgent = taskAgents.find((a) => a.id === focused) ?? taskAgents[0];

  const addShell = useCallback(
    (target: ShellTarget, stem?: string) => {
      const list = shells[selected] ?? [];
      if (list.length >= MAX_SHELLS) return;
      const s: Shell = { key: uuid(), computerId: target.id, session: newSession(stem ?? target.name, target.id, allShells) };
      setShells((all) => ({ ...all, [selected]: [...(all[selected] ?? []), s] }));
      setFocused(s.key);
    },
    [shells, selected, allShells, setFocused],
  );
  const removeShell = (key: string) => setShells((all) => ({ ...all, [selected]: (all[selected] ?? []).filter((s) => s.key !== key) }));

  /** ⌘D: a shell beside the focused agent, on its computer; in Shells, the menu of computers */
  const split = useCallback(() => {
    const agent = taskAgents.find((a) => a.id === focused) ?? taskAgents[0];
    const target = agent?.computerId ? targets?.find((t) => t.id === agent.computerId) : undefined;
    if (task && target) return addShell(target, task.root.title);
    if (targets?.length === 1) return addShell(targets[0]);
    setPicker((n) => n + 1);
  }, [taskAgents, focused, targets, task, addShell]);

  const tasksInOrder = useMemo(() => (tasks ? groupTasks(tasks).flatMap((g) => g.tasks) : []), [tasks]);
  const stepTask = useCallback(
    (d: 1 | -1) => {
      const ids = [SHELLS, ...tasksInOrder.map((t) => t.root.id)];
      const i = ids.indexOf(selected);
      setSelected(ids[(i + d + ids.length) % ids.length]);
    },
    [tasksInOrder, selected],
  );

  /** Review lives on the task's page: open it there, on a tab or already asking to merge or send back */
  const openTask = useCallback(
    (tab?: ReviewTab, act?: "merge" | "back") => {
      if (!task) return;
      requestTask({ id: task.root.id, tab, act });
      go({ view: "tasks" });
    },
    [task],
  );

  // the keys from the design; ⌘ shortcuts work everywhere in Code, others stay out of text fields and shells
  const lastEsc = useRef(0);
  useEffect(() => {
    if (!on) return;
    const k = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const t = e.target as HTMLElement | null;
      const inShell = !!t?.closest(".xterm");
      const typing = !inShell && !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const take = (f: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        f();
      };
      // Shells is the tmux-style workspace, which has its own split, pane and zoom keys
      const own = !task && (e.key.toLowerCase() === "d" || e.key === "Enter" || /^[1-9]$/.test(e.key));
      if (mod && own) return;
      if (mod && !e.shiftKey && !e.altKey) {
        const n = Number(e.key);
        if (n >= 1 && n <= 9 && paneIds[n - 1]) return take(() => setFocused(paneIds[n - 1]));
        switch (e.key.toLowerCase()) {
          case "k":
            return take(() => setPalette(true));
          case "n":
            return take(() => setSheet(true));
          case "b":
            // the task list is the pill's menu now
            return take(() => setSwitcher((v) => v + 1));
          case "]":
            return take(() => stepTask(1));
          case "[":
            return take(() => stepTask(-1));
          case "d":
            return take(split);
          case "i":
            return task && talkAgent ? take(() => setTalk((v) => v + 1)) : undefined;
          case "enter":
            return take(() => setLayout((l) => (l === "zoom" ? "main" : "zoom")));
        }
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") return take(split);
      if (mod && e.shiftKey && task) {
        const n = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
        if (n >= 0) return take(() => openTask((["changes", "files", "checks"] as const)[n]));
        // take the focused agent's keyboard, or hand it back
        const kb = e.key.toLowerCase() === "k" ? "take" : e.key.toLowerCase() === "h" ? "back" : null;
        if (kb) return take(() => window.dispatchEvent(new CustomEvent("wisp-code-keyboard", { detail: kb })));
        const act = e.key.toLowerCase() === "b" ? "back" : e.key.toLowerCase() === "m" ? "merge" : null;
        if (act) return take(() => openTask("changes", act));
      }
      if (e.altKey && !mod && !inShell && !typing && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const i = paneIds.indexOf(focused ?? "");
        const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
        if (paneIds.length) return take(() => setFocused(paneIds[(i + d + paneIds.length) % paneIds.length]));
      }
      if (e.altKey && !mod && (e.key === "1" || e.key === "2" || e.code === "Digit1" || e.code === "Digit2") && !inShell && !typing) return take(() => setLayout(e.code === "Digit2" || e.key === "2" ? "cols" : "main"));
      // esc twice stops the focused agent's current step
      if (e.key === "Escape" && !typing && !inShell) {
        const now = Date.now();
        if (now - lastEsc.current < 600 && focused) {
          const run = Object.values(useStore.getState().live).find((r) => r.agentId === focused);
          if (run) void api("POST", `/api/runs/${run.runId}/cancel`).catch(() => {});
        }
        lastEsc.current = now;
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [on, paneIds, focused, setFocused, stepTask, split, task, talkAgent, openTask]);

  const hasBranch = !!task && branchesOf(task).length > 0;

  // ⌘K: everything that has no button any more is here, with its key
  const paletteItems: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = [];
    taskAgents.forEach((a, i) => items.push({ id: `pane:${a.id}`, label: `Go to ${a.name}'s pane`, sub: task?.root.title, keys: `${MOD}${i + 1}`, icon: <GhostIcon color={agentColor(a)} size={13} />, run: () => setFocused(a.id) }));
    taskAgents.forEach((a) => items.push({ id: `talk:${a.id}`, label: `Talk to ${a.name}`, keys: `${MOD}I`, icon: <MessageSquare size={13} />, run: () => (setFocused(a.id), setTalk((v) => v + 1)) }));
    taskAgents.forEach((a) => {
      const t = a.computerId ? targets?.find((x) => x.id === a.computerId) : undefined;
      if (t) items.push({ id: `shell:${a.id}`, label: `Open a shell on ${a.name}'s computer`, sub: t.name, icon: <SquareTerminal size={13} />, run: () => addShell(t, task?.root.title) });
    });
    if (task) items.push({ id: "page", label: "Open the task's page", sub: "state, subtasks, merge", icon: <ListTodo size={13} />, run: () => openTask() });
    if (hasBranch) {
      items.push({ id: "review", label: "Review changes", keys: `${MOD}⇧1`, icon: <ListTodo size={13} />, run: () => openTask("changes") });
      items.push({ id: "merge", label: "Merge", keys: `${MOD}⇧M`, icon: <ListTodo size={13} />, run: () => openTask("changes", "merge") });
      items.push({ id: "back", label: "Send back", keys: `${MOD}⇧B`, icon: <ListTodo size={13} />, run: () => openTask("changes", "back") });
    }
    if (talkAgent) items.push({ id: "stop", label: `Stop ${talkAgent.name}`, keys: "Esc Esc", icon: <Square size={12} />, run: () => {
      const run = Object.values(useStore.getState().live).find((r) => r.agentId === talkAgent.id);
      if (run) void api("POST", `/api/runs/${run.runId}/cancel`).catch(() => {});
    } });
    items.push({ id: "new", label: "New task", keys: `${MOD}N`, icon: <Plus size={13} />, run: () => setSheet(true) });
    if (task) (targets ?? []).forEach((t) => items.push({ id: `sh:${t.id}`, label: `New shell on ${t.name}`, icon: <SquareTerminal size={13} />, run: () => addShell(t) }));
    items.push({ id: "shells", label: "Shells", sub: "plain terminals on your computers", icon: <SquareTerminal size={13} />, run: () => setSelected(SHELLS) });
    (tasks ?? []).forEach((t) => items.push({ id: `task:${t.root.id}`, label: t.root.title, sub: repoName(t.team.repo), icon: <span className="h-[7px] w-[7px] rounded-full" style={{ background: STATE_COLOR[t.state] }} />, run: () => setSelected(t.root.id) }));
    if (task) {
      items.push({ id: "main", label: "Main and stack", keys: "⌥1", icon: <MainIcon size={13} />, run: () => setLayout("main") });
      items.push({ id: "cols", label: "Side by side", keys: "⌥2", icon: <Columns2 size={13} />, run: () => setLayout("cols") });
      items.push({ id: "zoom", label: layout === "zoom" ? "Show all panes" : "Zoom this pane", keys: `${MOD}↵`, icon: <Maximize2 size={13} />, run: () => setLayout((l) => (l === "zoom" ? "main" : "zoom")) });
    }
    return items;
  }, [taskAgents, task, targets, tasks, layout, hasBranch, talkAgent, setFocused, addShell, openTask]);

  if (!on)
    return (
      <div className="flex h-full min-h-0 flex-col py-2 md:py-4">
        <div className={TERMINAL_BLOCK}>
          <Empty>
            <p className="text-[13px] text-[#a1a1aa]">Code is turned off.</p>
            <a href={href({ view: "mods" })} className="text-[12.5px] text-[#6aa2ff] hover:text-[#9cc2ff]">
              Mods
            </a>
          </Empty>
        </div>
      </div>
    );

  // the pill's menu: this task's panes (when there is more than one), Shells, every coding task, and New task
  const dot = (color: string) => <span className="mx-1 block h-2 w-2 rounded-full" style={{ background: color }} />;
  const titles = uniqueLabels(tasksInOrder.map((t) => t.root.title));
  const paneNames = uniqueLabels(paneIds.map((id) => taskAgents.find((a) => a.id === id)?.name ?? myShells.find((s) => s.key === id)?.session ?? "shell"));
  const taken = new Set(["Shells", "New task", "Task page", ...titles]);
  const switchItems: BarItems = [
    ...(task && paneIds.length > 1
      ? [
          ...paneIds.map((id, i) => {
            const a = taskAgents.find((x) => x.id === id);
            // a pane named like a task (or like a row below) still needs its own text
            const label = taken.has(paneNames[i]) ? `${paneNames[i]} (pane)` : paneNames[i];
            return { label, icon: id === focused ? <Check size={16} strokeWidth={2} /> : a ? <GhostIcon color={agentColor(a)} size={16} /> : <SquareTerminal size={16} strokeWidth={1.8} />, onSelect: () => setFocused(id) };
          }),
          "divider" as const,
        ]
      : []),
    { label: "Shells", icon: selected === SHELLS ? <Check size={16} strokeWidth={2} /> : <SquareTerminal size={16} strokeWidth={1.8} />, onSelect: () => setSelected(SHELLS) },
    ...tasksInOrder.map((t, i) => ({ label: titles[i], icon: t.root.id === selected ? <Check size={16} strokeWidth={2} /> : dot(STATE_COLOR[t.state]), onSelect: () => setSelected(t.root.id) })),
    "divider",
    { label: "New task", icon: <Plus size={16} strokeWidth={2} />, onSelect: () => setSheet(true) },
    ...(task ? [{ label: "Task page", icon: <ListTodo size={16} strokeWidth={1.8} />, onSelect: () => openTask() }] : []),
  ];

  const focusedShell = myShells.find((s) => s.key === focused);
  const computerName = focusedShell?.target.name ?? (talkAgent?.computerId ? (targets?.find((t) => t.id === talkAgent.computerId)?.name ?? computers.find((c) => c.id === talkAgent.computerId)?.name) : null);
  const pill = <Switcher agent={task ? talkAgent : undefined} label={task ? (talkAgent?.name ?? task.root.title) : "Shells"} items={switchItems} open={switcher} />;
  const layoutItem = (id: Layout, label: string, icon: React.ReactNode) => ({ label, icon: layout === id ? <Check size={16} strokeWidth={2} /> : icon, onSelect: () => setLayout(id) });

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {!task ? (
        <ShellWorkspace lead={pill} note={error && !tasks ? error : null} />
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">
          <CodeBar lead={pill} computer={computerName}>
            {!narrow && (
              <BarMenu
                icon={<Columns2 size={17} strokeWidth={1.8} />}
                label="Split"
                title="Layout"
                items={[layoutItem("main", "Main and stack", <MainIcon />), layoutItem("cols", "Side by side", <Columns2 size={16} strokeWidth={1.8} />), layoutItem("zoom", "Zoom", <Maximize2 size={15} strokeWidth={1.8} />)]}
              />
            )}
            {targets && targets.length > 0 && myShells.length < MAX_SHELLS && (
              <BarMenu
                open={picker}
                icon={<SquareTerminal size={17} strokeWidth={1.8} />}
                label="New shell"
                title={`New shell  ${MOD}D`}
                items={targets.map((t) => ({ label: t.online ? t.name : `${t.name} (offline)`, icon: <SquareTerminal size={15} strokeWidth={1.8} />, onSelect: () => addShell(t, task.root.title) }))}
              />
            )}
          </CodeBar>

          <div className={TERMINAL_BLOCK}>
            {paneIds.length === 0 ? (
              <Empty>
                <p className="text-[13px] text-[#a1a1aa]">No agent yet</p>
              </Empty>
            ) : (
              <div className="grid min-h-0 flex-1 gap-2.5 p-2.5" style={gridStyle(effLayout, paneIds.length)}>
                {paneIds.map((id, i) => {
                  const place = placeOf(effLayout, id, focused, paneIds, i);
                  if (!place) return null;
                  const agent = taskAgents.find((a) => a.id === id);
                  if (agent) return <AgentPane key={`${task.root.id}:${id}`} task={task} agent={agent} focused={focused === id} onFocus={() => setFocused(id)} style={place} shell={targets?.find((t) => t.kind === "device" && !!t.nodeId && t.nodeId === agent.nodeId)} />;
                  const s = myShells.find((x) => x.key === id)!;
                  return (
                    <div key={id} style={place} className="grid min-h-0 min-w-0">
                      <TerminalPane target={s.target} session={s.session} focused={focused === id} onFocus={() => setFocused(id)} onClose={() => removeShell(id)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {talkAgent ? <TalkBar key={`${task.root.id}:${talkAgent.id}`} task={task} agent={talkAgent} focus={talk} /> : <div className="h-2 shrink-0 md:h-4" />}
        </main>
      )}
      {sheet && <NewTaskSheet onClose={() => setSheet(false)} onStarted={(id) => (setSheet(false), id && setSelected(id))} />}
      {palette && <Palette items={paletteItems} onClose={() => setPalette(false)} />}
    </div>
  );
}

function MainIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16M12 12h9" />
    </svg>
  );
}

function gridStyle(layout: Layout, n: number): CSSProperties {
  if (layout === "zoom" || n === 1) return { gridTemplateColumns: "minmax(0,1fr)", gridTemplateRows: "minmax(0,1fr)" };
  if (layout === "cols") {
    const cols = Math.min(n, 3);
    return { gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${Math.ceil(n / cols)}, minmax(0,1fr))` };
  }
  return { gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gridTemplateRows: `repeat(${n - 1}, minmax(0,1fr))` };
}

/** Where a pane sits: the focused one big on the left and the rest stacked, side by side, or zoomed. */
function placeOf(layout: Layout, id: string, focused: string | null, ids: string[], i: number): CSSProperties | null {
  if (layout === "zoom" || ids.length === 1) return id === focused || (!focused && i === 0) ? { gridColumn: 1, gridRow: 1 } : null;
  if (layout === "cols") return {};
  if (id === focused) return { gridColumn: 1, gridRow: `1 / span ${ids.length - 1}` };
  const rest = ids.filter((x) => x !== focused);
  return { gridColumn: 2, gridRow: rest.indexOf(id) + 1 };
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center px-6 pb-16 text-center">
      <div className="m-fade-in flex max-w-[320px] flex-col items-center gap-3">
        <SquareTerminal size={22} strokeWidth={1.6} className="text-[#8e8e96]" />
        {children}
      </div>
    </div>
  );
}
