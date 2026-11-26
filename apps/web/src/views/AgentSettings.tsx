import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Brain, ChevronLeft, GitCommitHorizontal, Monitor, MessageSquare, MoreHorizontal, Plug, ShieldAlert, ShieldCheck } from "lucide-react";
import { HARNESSES, VM_HARNESSES, runsInVm, type AccessLevel, type Agent, type HarnessCatalog } from "@bubble-ai/core";
import { HarnessLogo } from "../components/HarnessLogo.tsx";
import { soulPath, soulTemplate } from "@bubble-ai/core/src/soul.ts";
import { ConnectionInstructions } from "../components/ConnectionInstructions.tsx";
import { useAccess } from "../access.ts";
import { connectorBlocker, connectorOrigin } from "../components/Access.tsx";
import { ApiError, api } from "../api.ts";
import { useStore } from "../store.ts";
import { go, guardLeaving, href, mayLeave, type AgentTab } from "../router.ts";
import { LookPanel } from "./LookEditor.tsx";
import { effortName, prettyModel } from "../components/EffortSlider.tsx";
import { SaveBar } from "./SettingsParts.tsx";
import { useFeatures } from "../features.ts";
import { AccessPanel, CARD, CanUse, Group, InPlace, Knows, Line, More, RemoveConfirm, SELECT, TAB_TITLES, Toggle } from "./AgentSections.tsx";
import { AgentAvatar, Button, CopyBlock, Field, harnessLabel, Input, Pill, StatusDot, Textarea, cx, timeAgo, AGENT_STATUS } from "../components/ui.tsx";
import { PopNav } from "../components/SettingsDialog.tsx";
import { RoutinesPanel, runsOnDevice } from "./AgentComputer.tsx";
import { RunsOn } from "./AgentRunsOn.tsx";
import { BackgroundPanel } from "./AgentBackground.tsx";
import { agentReadiness, isSharedComputer, useDevices, type DeviceInfo } from "../devices.ts";
import { useComputerMode } from "../computerMode.ts";
import { setupNextStep } from "../components/AgentPanel.tsx";
import { openDm } from "../openDm.ts";

export type NodeInfo = DeviceInfo;

type FullAgent = Agent & { instructions?: string };

/** The six groups of an agent's page, in order: the same six rows the agent panel beside a chat has. */
export const AGENT_GROUPS = ["thinks", "works", "can", "asks", "knows", "more"] as const;
export type AgentGroup = (typeof AGENT_GROUPS)[number];
export const GROUP_TITLES: Record<AgentGroup, string> = { thinks: "Thinks with", works: "Works on", can: "Can use", asks: "Asks first", knows: "Knows", more: "More" };
const GROUP_ICON: Record<AgentGroup, ReactNode> = {
  thinks: <Brain size={20} strokeWidth={1.8} />,
  works: <Monitor size={20} strokeWidth={1.8} />,
  can: <Plug size={20} strokeWidth={1.8} />,
  asks: <ShieldCheck size={20} strokeWidth={1.8} />,
  knows: <BookOpen size={20} strokeWidth={1.8} />,
  more: <MoreHorizontal size={20} strokeWidth={1.8} />,
};

/** The group each old tab's settings live in now (the overview is the page's top). */
const TAB_GROUP: Record<AgentTab, AgentGroup | null> = {
  overview: null,
  model: "thinks",
  device: "works",
  computer: "works",
  skills: "can",
  apps: "can",
  permissions: "asks",
  memory: "knows",
  soul: "knows",
  instructions: "knows",
  look: "more",
  access: "more",
  background: "more",
  routines: "more",
  connect: "more",
  runs: "more",
  remove: "more",
};
/** Tabs that are a part of their group, opened from one of its rows; the others are the group's own rows. */
const PARTS: readonly AgentTab[] = ["soul", "instructions", "look", "access", "background", "routines", "connect", "runs"];

/** Where an address of the old 12-tab page lands: its group, and the part of it to open (null when the group's rows are the thing). */
export function agentPlace(tab: AgentTab | null | undefined): { group: AgentGroup | null; part: AgentTab | null } {
  return { group: tab ? TAB_GROUP[tab] : null, part: tab && PARTS.includes(tab) ? tab : null };
}

/** True from the width where the page has room for the list of groups beside the picked one. */
function useWide(): boolean {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query)?.matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq?.addEventListener) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * One agent's page: its live ghost, its name and what it does (both edited in place) and Message;
 * then six groups (Thinks with, Works on, Can use, Asks first, Knows, More) of one-line rows, the
 * rest of each behind "Show all". Desktops list the groups on the left and show the picked one;
 * phones show all six down one page. A row that needs room (personality, look, schedules…) opens
 * as a part with Back. Parts you type in stay mounted, so a draft survives looking elsewhere.
 */
export function AgentDetail({ agent, nodes, tab }: { agent: FullAgent; nodes: NodeInfo[]; tab: AgentTab | null }) {
  const features = useFeatures();
  const refreshAgents = useStore((s) => s.refreshAgents);
  // a tab for a mod that's off isn't there; its old address lands on the page's top
  const offTabs: AgentTab[] = [...(features.routines ? [] : ["routines" as const]), ...(features.background ? [] : ["background" as const])];
  const active = tab && !offTabs.includes(tab) ? tab : "overview";
  const place = agentPlace(active);
  const part = place.part;
  const wide = useWide();
  const [group, setGroup] = useState<AgentGroup>(place.group ?? "thinks");
  const picked = useRef(!!place.group);
  useEffect(() => {
    if (!place.group) return;
    picked.current = true;
    setGroup(place.group);
  }, [place.group, active]);
  const [dirty, setDirty] = useState<Partial<Record<AgentTab, boolean>>>({});
  const hasDirty = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (!hasDirty) return;
    const unguard = guardLeaving(() => `${agent.name} has unsaved changes. Leave without saving them?`);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
      // Parts stay mounted, so moving between them keeps all edits.
      if (url.hash === `#/agents/${agent.id}` || url.hash.startsWith(`#/agents/${agent.id}/`)) return;
      if (!mayLeave()) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick);
    return () => {
      unguard();
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick);
    };
  }, [hasDirty, agent.id, agent.name]);
  const markDirty = useCallback((t: AgentTab) => (d: boolean) => setDirty((cur) => (cur[t] === d ? cur : { ...cur, [t]: d })), []);

  const devices = useDevices();
  const readiness = agentReadiness(agent, devices);
  const next = setupNextStep(agent, devices);
  // nothing picked yet and something is missing: open on the group that says what
  useEffect(() => {
    if (!readiness.ready && !picked.current) setGroup("works");
  }, [readiness.ready]);
  // a fix that lives on this page is the row right there (the device picker, or Sign in under Show all)
  const fixHere = !!next && next.href.startsWith(`#/agents/${agent.id}/`);

  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    // phones show every group down one page: an old tab's address brings its group into view
    const target = !part && !wide && place.group ? el.querySelector<HTMLElement>(`[data-group="${place.group}"]`) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else el.scrollTo({ top: 0 });
  }, [active, group, wide]);

  const to = (t: AgentTab) => href({ view: "agents", agentId: agent.id, tab: t });
  const top = to("overview");
  const pick = (g: AgentGroup) => {
    picked.current = true;
    setGroup(g);
    if (part) go({ view: "agents", agentId: agent.id, tab: "overview" });
  };
  const rename = async (name: string) => {
    if (!name) throw new Error("A name is needed");
    await api("PATCH", `/api/agents/${agent.id}`, { name });
    await refreshAgents();
  };
  const setRole = async (role: string) => {
    await api("PATCH", `/api/agents/${agent.id}`, { settings: { role } });
    await refreshAgents();
  };
  const ghost = (size: number) => (
    <a href={to("look")} aria-label={`Change ${agent.name}'s look`} className="shrink-0 rounded-full">
      <AgentAvatar agent={agent} size={size} live />
    </a>
  );
  const message = (
    <Button variant="primary" onClick={() => void openDm(agent.id)}>
      <MessageSquare size={15} /> Message
    </Button>
  );

  const body = (g: AgentGroup): ReactNode => {
    switch (g) {
      case "thinks":
        return <ThinksWith agent={agent} nodes={nodes} />;
      case "works":
        return <RunsOn agent={agent} nodes={nodes} problem={readiness.ready ? null : (readiness.problem ?? "Setup incomplete")} fix={fixHere ? null : next} />;
      case "can":
        return <CanUse agent={agent} />;
      case "asks":
        return <AsksFirst agent={agent} nodes={nodes} />;
      case "knows":
        return <Knows agent={agent} />;
      case "more":
        return <More agent={agent} nodes={nodes} />;
    }
  };
  const unsaved = (g: AgentGroup) => (Object.keys(dirty) as AgentTab[]).some((t) => dirty[t] && TAB_GROUP[t] === g);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* phones: back, and over a part its title with the agent's name under it */}
      <header className="md:hidden shrink-0 flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <a href={part ? top : "#/agents"} className="circle" aria-label={part ? `Back to ${agent.name}` : "Back to agents"}>
          <ChevronLeft size={22} />
        </a>
        {part && (
          <>
            <div className="flex-1 min-w-0 text-center">
              <div className="text-[14px] font-semibold truncate">{TAB_TITLES[part]}</div>
              <div className="text-[13px] text-muted truncate">{agent.name}</div>
            </div>
            <span className="w-11" aria-hidden />
          </>
        )}
      </header>
      <div className="flex-1 min-h-0 flex">
        {/* desktops (the pop-up): the live ghost, its name and what it does, how it is, Message, then its sections */}
        <aside className="hidden md:flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-line bg-sidebar px-3 pt-5 pb-5">
          <div className="mb-4 flex flex-col items-start gap-2.5 px-2">
            {ghost(76)}
            <div className="w-full min-w-0">
              <InPlace value={agent.name} onSave={rename} label="Name" maxLength={80} className="-ml-1.5 block h-8 w-full truncate text-[19px] font-semibold leading-[26px]" />
              <InPlace value={agent.settings.role ?? ""} onSave={setRole} label="What it does" placeholder="What it does" maxLength={60} className="-ml-1.5 block h-6 w-full truncate text-[13px] text-muted focus:text-ink" />
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
                <StatusDot status={agent.status} needsSignIn={!!agent.signIn} />
                <span className="truncate">
                  {harnessLabel(agent.harness)} · {agent.signIn && agent.status === "online" ? "needs sign-in" : (AGENT_STATUS[agent.status]?.label ?? "Offline")}
                </span>
              </div>
            </div>
            <div className="mt-1">{message}</div>
          </div>
          <PopNav label={`${agent.name}'s settings`} current={group} items={AGENT_GROUPS.map((g) => ({ key: g, label: GROUP_TITLES[g], icon: GROUP_ICON[g], onSelect: () => pick(g), dot: unsaved(g) ? "unsaved" : g === "works" && !readiness.ready ? "needs" : null }))} />
        </aside>
        {/* md:px-8 is the room a part's save bar (-mx-8) reaches into */}
        <div ref={content} className="flex-1 min-w-0 overflow-y-auto px-4 md:px-8 pt-1 md:pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="max-w-[640px] max-md:mx-auto">
            {!part && (
              <div className="space-y-6">
                {/* the profile, on phones */}
                <div className="md:hidden flex flex-col items-center gap-1 text-center">
                  {ghost(76)}
                  <InPlace value={agent.name} onSave={rename} label="Name" maxLength={80} className="mt-2 h-8 w-full max-w-xs text-center text-[19px] font-semibold leading-[26px]" />
                  <InPlace value={agent.settings.role ?? ""} onSave={setRole} label="What it does" placeholder="What it does" maxLength={60} className="h-6 w-full max-w-xs text-center text-sm text-muted focus:text-ink" />
                  <div className="mt-2">{message}</div>
                </div>
                {(wide ? [group] : AGENT_GROUPS).map((g) => (
                  <div key={g} data-group={g} className={cx("scroll-mt-3", wide && "settings-pop-section")}>
                    <Group title={GROUP_TITLES[g]}>{body(g)}</Group>
                  </div>
                ))}
              </div>
            )}
            {part && (
              <div className="hidden md:block pb-4">
                <a href={top} className="-ml-1 inline-flex h-7 items-center gap-0.5 text-[13px] text-muted hover:text-ink">
                  <ChevronLeft size={15} aria-hidden /> {place.group ? GROUP_TITLES[place.group] : agent.name}
                </a>
                <h2 className="text-[19px] font-semibold leading-[26px]">{TAB_TITLES[part]}</h2>
              </div>
            )}
            <Panel show={part === "look"}>
              <LookPanel agent={agent} onDirty={markDirty("look")} active={part === "look"} />
            </Panel>
            <Panel show={part === "soul"}>
              <SoulPanel agent={agent} onDirty={markDirty("soul")} active={part === "soul"} />
            </Panel>
            <Panel show={part === "instructions"}>
              <InstructionsPanel agent={agent} onDirty={markDirty("instructions")} active={part === "instructions"} />
            </Panel>
            {part === "access" && (
              <div className="m-panel">
                <AccessPanel agent={agent} device={nodes.find((n) => n.id === agent.nodeId)} />
              </div>
            )}
            <Panel show={part === "background"}>
              <BackgroundPanel agent={agent} active={part === "background"} onDirty={markDirty("background")} />
            </Panel>
            <Panel show={part === "routines"}>
              <RoutinesPanel agent={agent} active={part === "routines"} />
            </Panel>
            <Panel show={part === "connect"}>
              <ConnectPanel agent={agent} />
            </Panel>
            <Panel show={part === "runs"}>
              <RunsPanel agent={agent} active={part === "runs"} />
            </Panel>
            {active === "remove" && <RemoveConfirm agent={agent} onClose={() => go({ view: "agents", agentId: agent.id, tab: "overview" })} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A part that stays mounted while it is out of sight, so what was typed in it is kept; it slides in when shown. */
function Panel({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div hidden={!show} className="m-panel">
      {children}
    </div>
  );
}

// --- Soul ---------------------------------------------------------------------

interface Commit {
  hash: string;
  author: string;
  date: string;
  message: string;
}

/** Its personality (SOUL.md), as text. Whether it may rewrite it itself is a switch under Asks first. */
function SoulPanel({ agent, onDirty, active }: { agent: FullAgent; onDirty: (d: boolean) => void; active: boolean }) {
  const path = soulPath(agent.id);
  const [saved, setSaved] = useState<string | null>(null); // null = no soul yet
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [last, setLast] = useState<Commit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const n = await api<{ content: string }>("GET", `/api/vault/note?path=${encodeURIComponent(path)}`);
      setSaved(n.content);
      setDraft(n.content);
      const h = await api<Commit[]>("GET", `/api/vault/history?path=${encodeURIComponent(path)}`);
      setLast(h[0] ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setSaved(null);
        setDraft("");
      } else setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);
  // pick up the agent's own edits when coming back to it
  useEffect(() => {
    if (active && saved !== null && draft === saved) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const dirty = saved === null ? draft.trim() !== "" : draft !== saved;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api("PUT", "/api/vault/note", { path, content: draft, message: `Update soul of @${agent.handle}` });
      await load();
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const editedByAgent = last?.author === `@${agent.handle}`;

  return (
    <div>
      {!loaded ? (
        <p className="px-1 text-[13px] text-muted">Loading…</p>
      ) : saved === null && !draft ? (
        <div className="space-y-3">
          <p className="px-1 text-[14px] text-muted">Not written yet</p>
          <Button onClick={() => setDraft(soulTemplate(agent.name, agent.handle))}>Start from a template</Button>
        </div>
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck
          aria-label="SOUL.md"
          className="min-h-[420px] w-full resize-y rounded-[14px] border border-line bg-bg px-4 py-3 font-mono text-[13.5px] leading-relaxed outline-none focus:border-ink/40"
        />
      )}
      {last && (
        <p className="mt-2 flex items-center gap-1.5 px-1 text-[13px] text-muted">
          <GitCommitHorizontal size={14} />
          {editedByAgent ? `Refined by @${agent.handle}` : `Edited by ${last.author}`} {timeAgo(last.date)} ·{" "}
          <a className="text-ink underline underline-offset-2" href={`#/vault/${path}`}>
            history
          </a>
        </p>
      )}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(saved ?? "")} active={active} />
    </div>
  );
}

// --- Instructions -------------------------------------------------------------

/** Follow remote saves only for fields still equal to their previous saved value. */
export function mergeSavedFields<T extends object>(draft: T, previous: T, saved: T): T {
  return Object.fromEntries(Object.keys(saved).map((key) => {
    const k = key as keyof T;
    return [k, Object.is(draft[k], previous[k]) ? saved[k] : draft[k]];
  })) as T;
}

function useSavedDraft<T extends object>(saved: T) {
  const [draft, setDraft] = useState(saved);
  const previous = useRef(saved);
  useEffect(() => {
    const before = previous.current;
    if (Object.keys(saved).every((k) => Object.is(saved[k as keyof T], before[k as keyof T]))) return;
    previous.current = saved;
    setDraft((current) => {
      const next = mergeSavedFields(current, before, saved);
      return Object.keys(next).every((k) => Object.is(next[k as keyof T], current[k as keyof T])) ? current : next;
    });
  }, [saved]);
  return [draft, setDraft] as const;
}

/** The most instructions the hub keeps; the count shows once most of it is used. */
const INSTRUCTIONS_MAX = 20_000;

/** Its job in full: what the role covers, and the instructions sent with every request. The one-line role is the line under its name. */
function InstructionsPanel({ agent, onDirty, active }: { agent: FullAgent; onDirty: (d: boolean) => void; active: boolean }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const others = useStore((s) => s.agents).filter((a) => a.id !== agent.id);
  const saved = agent.instructions ?? "";
  const savedNotes = agent.settings.roleNotes ?? "";
  const [form, setForm] = useSavedDraft({ draft: saved, roleNotes: savedNotes });
  const { draft, roleNotes } = form;
  const setDraft = (value: string | ((d: string) => string)) => setForm((f) => ({ ...f, draft: typeof value === "function" ? value(f.draft) : value }));
  const setRoleNotes = (value: string) => setForm((f) => ({ ...f, roleNotes: value }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notesDirty = roleNotes !== savedNotes;
  const dirty = draft !== saved || notesDirty;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  const helper = others[0] ? `@${others[0].handle}` : "@another-agent";
  const snippets = [
    { label: "What it owns", text: `## What you own\nYou own <area>. You decide <what>, and you ask before <what>.` },
    { label: "Memory habits", text: `## Memory\n- Search memory before answering questions about past work.\n- After finishing something, append one line to me/log.md: what changed and why.\n- Put decisions everyone needs in shared/.` },
    { label: "Handoffs", text: `## Working with others\n- Hand work outside your area to ${helper} with task_delegate. Include what "done" means.\n- Mark your own tasks done with task_update and a short result.` },
    { label: "Reply style", text: `## Replies\n- Lead with the answer.\n- Say what you changed and where, with file paths.` },
  ];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { instructions: draft, ...(notesDirty ? { settings: { roleNotes } } : {}) });
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
      <div className="mb-4">
        <Field label="What the role covers">
          <Input value={roleNotes} onChange={(e) => setRoleNotes(e.target.value)} maxLength={2000} placeholder="Owns the backend and the build; send it bugs and API work." aria-label="What the role covers" />
        </Field>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {snippets.map((s) => (
          <button key={s.label} onClick={() => setDraft((d) => (d.trim() ? d.replace(/\s*$/, "\n\n") : "") + s.text + "\n")} className="text-xs rounded-full border border-line px-2.5 py-1 hover:bg-hover">
            + {s.label}
          </button>
        ))}
      </div>
      <Textarea
        rows={16}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Instructions"
        placeholder={`You own the backend. Keep notes on decisions in me/decisions.md, and hand UI work to ${helper}.`}
        className="font-mono text-[13.5px] leading-relaxed resize-y min-h-[300px]"
      />
      {draft.length > INSTRUCTIONS_MAX * 0.8 && (
        <div className="mt-1 text-xs text-faint text-right">
          {draft.length.toLocaleString()} / {INSTRUCTIONS_MAX.toLocaleString()}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => (setDraft(saved), setRoleNotes(savedNotes))} active={active} />
    </div>
  );
}

// --- Thinks with --------------------------------------------------------------

/**
 * The AIs an agent can switch to: the ones installed where it runs (its device, or the computer it
 * runs inside), and the one it has now. Agents that join from outside keep theirs.
 */
export function harnessChoices(agent: Pick<Agent, "harness" | "computerId" | "settings">, device: Pick<DeviceInfo, "harnesses" | "vmSignIns"> | undefined): string[] {
  const inVm = runsInVm(agent.harness) && agent.settings.runIn === "computer" && !!agent.computerId;
  const vm = inVm ? Object.keys(device?.vmSignIns?.[agent.computerId!] ?? {}) : [];
  const here = inVm ? (vm.length ? vm : VM_HARNESSES) : (device?.harnesses ?? []).map((h) => h.id);
  const list = [...new Set([agent.harness, ...here])].filter((id) => id === agent.harness || runsOnDevice(id));
  // the order Bubble AI lists them in everywhere, then any a device declared itself
  const order = HARNESSES.map((h) => h.id);
  return list.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
}

/**
 * What it thinks with, as rows: its AI (switch it here, as /harness does in chat), the model, the
 * effort, and Fast when the model has it. Each saves as it changes. A model that isn't on the list is
 * typed in ("Other model…"); its handle is behind "Show all".
 */
function ThinksWith({ agent, nodes }: { agent: FullAgent; nodes: NodeInfo[] }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const device = nodes.find((n) => n.id === agent.nodeId);
  const choices = harnessChoices(agent, device);
  const [info, setInfo] = useState<{ device: { name: string; online: boolean } | null; catalog: HarnessCatalog | null } | null>(null);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hLabel = harnessLabel(agent.harness);
  const headless = runsOnDevice(agent.harness);

  useEffect(() => {
    if (headless) api<NonNullable<typeof info>>("GET", `/api/agents/${agent.id}/models`).then(setInfo, () => setInfo({ device: null, catalog: null }));
  }, [agent.id, agent.nodeId, headless]);

  const models = info?.catalog?.models ?? [];
  const model = agent.model ?? "";
  // a model id the catalog doesn't know about is shown as a custom model
  useEffect(() => {
    if (info && model && !models.some((m) => m.id === model)) setCustom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, model]);

  if (!headless)
    return (
      <div className={CARD}>
        <Line label="AI" value={hLabel} />
        <Line label="Model" value={`Set in ${hLabel}`} />
      </div>
    );

  // with no model picked the harness uses its own default, which has the efforts and fast tier too
  const offered = (id: string) => {
    const m = models.find((x) => x.id === (id || info?.catalog?.defaultModel));
    return { model: m, efforts: m?.efforts ?? info?.catalog?.efforts ?? ["low", "medium", "high"] };
  };
  const { model: selected, efforts } = offered(model);
  const effort = agent.settings.effort ?? "";
  const effortDropped = !!effort && !efforts.includes(effort);
  // the device's configured effort wins over the model's own default, as in Codex
  const defaultEffort = [info?.catalog?.defaultEffort, selected?.defaultEffort].find((e) => e && efforts.includes(e)) ?? efforts[0];

  const patch = async (body: unknown) => {
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, body);
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };
  // a new AI starts on its own default model and effort; its memory, skills and chats stay
  const setHarness = (id: string) => {
    if (id === agent.harness) return;
    setCustom(false);
    void patch({ harness: id, model: null, settings: { effort: null, fast: false } }).catch(() => {});
  };
  // an effort the new model doesn't offer goes back to the default with it
  const setModel = (id: string) => patch({ model: id.trim() || null, ...(effort && !offered(id.trim()).efforts.includes(effort) ? { settings: { effort: null } } : {}) });

  // why there are no models to pick, for whoever hovers the picker
  const why = !agent.nodeId
    ? "No device yet"
    : !info?.device
      ? null
      : !info.catalog
        ? info.device.online
          ? `${info.device.name} hasn't reported ${hLabel} models`
          : `${info.device.name} is offline`
        : null;

  return (
    <>
      <div className={CARD}>
        <Line label="AI">
          <HarnessLogo harness={agent.harness} size={16} />
          <select aria-label="AI" value={agent.harness} onChange={(e) => setHarness(e.target.value)} disabled={choices.length < 2} title={choices.length < 2 ? "Nothing else is installed where it runs" : undefined} className={SELECT}>
            {choices.map((id) => (
              <option key={id} value={id}>
                {harnessLabel(id)}
              </option>
            ))}
          </select>
        </Line>
        <Line label="Model">
          <select
            aria-label="Model"
            title={why ?? undefined}
            value={custom ? "__custom" : model}
            onChange={(e) => {
              if (e.target.value === "__custom") return setCustom(true);
              setCustom(false);
              void setModel(e.target.value).catch(() => {});
            }}
            className={SELECT}
          >
            <option value="">Automatic</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {prettyModel(m.label)}
              </option>
            ))}
            <option value="__custom">Other model…</option>
          </select>
        </Line>
        {custom && (
          <Line label="Model id">
            <InPlace value={model} onSave={setModel} label="Model id" placeholder={agent.harness === "codex" ? "gpt-6.1-sol" : "claude-opus-5-5"} className="h-8 w-48 border border-line bg-panel text-[13px] text-ink" />
          </Line>
        )}
        {efforts.length > 0 && (
          <Line label="Effort">
            <select aria-label="Reasoning effort" value={effortDropped ? "" : effort} onChange={(e) => void patch({ settings: { effort: e.target.value || null } }).catch(() => {})} className={SELECT}>
              <option value="">Default ({effortName(defaultEffort)})</option>
              {efforts.map((x) => (
                <option key={x} value={x}>
                  {effortName(x)}
                </option>
              ))}
            </select>
          </Line>
        )}
        {selected?.fast && (
          <Line label="Fast">
            {selected.fast.description && <span className="truncate">{selected.fast.description}</span>}
            <Toggle label="Fast mode" on={!!agent.settings.fast} onChange={(v) => void patch({ settings: { fast: v } }).catch(() => {})} />
          </Line>
        )}
      </div>
      {effortDropped && (
        <p className="px-1 text-[13px] text-st-needs">
          {selected?.label ?? "This model"} doesn't support “{effort}”; it uses its default.
        </p>
      )}
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
    </>
  );
}

// --- Asks first ---------------------------------------------------------------

const ACCESS: Record<AccessLevel, string> = { "read-only": "Read only", edit: "Can edit files", full: "Full access" };

/** Where an agent's files are, for the access text: the shared computer, its own, or a device's folder. */
export interface AccessPlace {
  /** the device its AI runs on */
  device?: string;
  /** the computer it works on: the shared one, its own, or none (it works in a folder on the device) */
  computer: "shared" | "own" | null;
  handle: string;
  advanced: boolean;
}

/**
 * The effective reach of an access level, plainly (edit = the harness's workspace sandbox: its own
 * folder). An agent with a computer works in that computer's files (on the shared one, a folder of
 * its own in them); without one, in a folder on its device. Paths and caveats are for Advanced.
 */
export function accessScope(access: AccessLevel, name: string, p: AccessPlace): string {
  if (!p.device) return "It has no device yet, so it can't touch any files.";
  const folder = p.computer === "shared" ? "its own folder on the shared computer" : p.computer === "own" ? "its computer's files" : `its own folder on ${p.device}`;
  const path = p.computer === "shared" ? `~/files/${p.handle}` : p.computer === "own" ? "~/files" : `~/.bubble-ai/agents/${p.handle}`;
  if (access === "read-only") return `${name} reads files and asks before changing any.`;
  if (access === "edit") return `${name} can change files in ${folder}, and asks before changing anything else.${p.advanced ? ` (${path}; some AI tools can't hold to this strictly.)` : ""}`;
  return `${name} can change any file and run any command on ${p.device}, where its AI runs, if ${p.device} allows full access. If it doesn't, ${name} can edit files only.`;
}

/** Harnesses Bubble AI can keep the person's own plugins out of. */
const OWN_PLUGINS_HARNESSES = ["codex", "claude-code", "gemini"];

/**
 * What it may do without asking: its level for files and commands, and whether it may rewrite its
 * own personality. Each saves as it changes. Using the person's own plugins (which skip Bubble AI's
 * approvals) is behind "Show all"; the level's reach in full is the picker's tooltip.
 */
function AsksFirst({ agent, nodes }: { agent: FullAgent; nodes: NodeInfo[] }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const computer = useStore((s) => s.computers).find((c) => c.id === agent.computerId);
  const { advanced } = useComputerMode();
  const place: AccessPlace = {
    device: nodes.find((n) => n.id === agent.nodeId)?.name,
    computer: isSharedComputer(computer) ? "shared" : computer?.kind === "vm" ? "own" : null,
    handle: agent.handle,
    advanced,
  };
  const access = agent.settings.access ?? "edit";
  const ownPlugins = !!agent.settings.ownPlugins;
  const canOwnPlugins = OWN_PLUGINS_HARNESSES.includes(agent.harness);
  const [error, setError] = useState<string | null>(null);

  const patch = async (settings: { access?: AccessLevel; ownPlugins?: boolean; soulLocked?: boolean }) => {
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { settings });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <div className={CARD}>
        <Line label="Files and commands">
          <select aria-label="Files and commands" title={accessScope(access, agent.name, place)} value={access} onChange={(e) => void patch({ access: e.target.value as AccessLevel })} className={SELECT}>
            {(Object.keys(ACCESS) as AccessLevel[]).map((a) => (
              <option key={a} value={a}>
                {ACCESS[a]}
              </option>
            ))}
          </select>
        </Line>
        <Line label="Edits its personality">
          <Toggle label={`Let @${agent.handle} refine its own personality`} on={!agent.settings.soulLocked} onChange={(v) => void patch({ soulLocked: !v })} />
        </Line>
        <Line label="Approvals" value="For all agents" to={href({ view: "settings", page: "agents" })} />
        {canOwnPlugins && (
          <Line label={`My own ${harnessLabel(agent.harness)} plugins`}>
            <Toggle label={`Use my own ${harnessLabel(agent.harness)} plugins`} on={ownPlugins} onChange={(v) => void patch({ ownPlugins: v })} />
          </Line>
        )}
        <Line label="Edits its instructions" value="Only people" />
      </div>
      {access === "full" && (
        <p className="flex gap-2 px-1 text-[13px] text-bad">
          <ShieldAlert size={15} className="shrink-0 mt-0.5" />
          {advanced ? (
            <span>
              It can run any command as {place.device ?? "the device"}'s user. The device must opt in with <code>bubble-ai node start --allow-full-access</code>; otherwise it runs with edit access.
            </span>
          ) : (
            <span>Only for an agent you trust: it can change anything{place.device ? ` on ${place.device}` : ""}.</span>
          )}
        </p>
      )}
      {canOwnPlugins && ownPlugins && (
        <p className="flex gap-2 px-1 text-[13px] text-bad">
          <ShieldAlert size={15} className="shrink-0 mt-0.5" />
          These skip Bubble AI's approvals and the screen switch.
        </p>
      )}
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
    </>
  );
}

// --- Activity -----------------------------------------------------------------

interface RunRow {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  channelId: string;
  threadId: string | null;
  channelName: string | null;
  channelKind: string | null;
  trigger: string | null;
  /** "background" for a check the agent made on its own; an empty trigger alone can also mean a DM the viewer can't see */
  kind?: string | null;
  /** a failure in plain words, when the hub recognised it (the harness needs signing in on its device) */
  hint?: string | null;
}

const RUN_TONE: Record<string, "ok" | "bad" | "warn" | "info" | "neutral"> = { done: "ok", failed: "bad", running: "info", queued: "warn", cancelled: "neutral" };

/** A run's status in plain words. */
export function runStatusLabel(status: string): string {
  const known: Record<string, string> = { queued: "Waiting to start", running: "Working", done: "Done", failed: "Didn't finish", cancelled: "Stopped" };
  return known[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

/** A readable name for a run, from the body of the message that woke the agent ("" when there's no message to show). */
export function runTitle(trigger: string | null): string {
  const text = (trigger ?? "").trim();
  if (!text) return "";
  const body = text.replace(/^(?:@[\w.-]+\s*)+/, "");
  const task = body.match(/^New task \*\*(.+?)\*\*/);
  if (task) return `Task: ${task[1]}`;
  const routine = body.match(/^Run the routine \*\*(.+?)\*\*/);
  if (routine) return `Routine: ${routine[1]}`;
  const learn = body.match(/^I just showed you how to \*\*(.+?)\*\*/);
  if (learn) return `Learning: ${learn[1]}`;
  const line = (body.split("\n").find((l) => l.trim()) ?? "")
    .replace(/\*\*|`/g, "")
    .replace(/(^|\s)_+|_+(?=\s|$)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "Message";
  return line.length > 80 ? `${line.slice(0, 80).trimEnd()}…` : line;
}

function RunsPanel({ agent, active }: { agent: FullAgent; active: boolean }) {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  useEffect(() => {
    if (active) api<RunRow[]>("GET", `/api/agents/${agent.id}/runs?limit=50`).then(setRuns, () => setRuns([]));
  }, [active, agent.id]);
  return <RunList runs={runs} />;
}

function RunList({ runs }: { runs: RunRow[] | null }) {
  if (!runs) return <p className="px-1 text-[13px] text-muted">Loading…</p>;
  if (!runs.length) return <p className="px-1 text-[13px] text-muted">Nothing yet</p>;
  return (
    <div className={CARD}>
      {runs.map((r) => {
        const secs = r.finishedAt ? Math.max(0, Math.round((new Date(r.finishedAt).getTime() - new Date(r.createdAt).getTime()) / 1000)) : null;
        const channel = r.channelKind === "dm" ? "DM" : `#${r.channelName ?? ""}`;
        const why = r.hint || r.error;
        return (
          <div key={r.id} className="px-3.5 py-2.5 text-sm">
            <div className="flex items-center gap-3">
              <Pill tone={RUN_TONE[r.status] ?? "neutral"}>{runStatusLabel(r.status)}</Pill>
              <span className="min-w-0 flex-1">
                <a href={`#/c/${r.channelId}${r.threadId ? `/t/${r.threadId}` : ""}`} className="block truncate hover:underline">
                  {r.kind === "background" ? "Background check" : runTitle(r.trigger) || "Message"}
                </a>
                {why && <span className="block text-xs text-bad break-words">{why.replace(/`/g, "")}</span>}
              </span>
              <span className="text-xs text-muted shrink-0 hidden sm:inline">{channel}</span>
              {secs !== null && <span className="text-xs text-faint shrink-0 tabular-nums w-10 text-right">{secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`}</span>}
              {r.status === "failed" && r.channelName !== null && (
                <button type="button" className="text-xs font-medium text-ink underline underline-offset-2 shrink-0" onClick={() => void api("POST", `/api/runs/${r.id}/retry`).catch((e) => alert((e as Error).message))}>
                  Try again
                </button>
              )}
              <span className="text-xs text-faint shrink-0 w-16 text-right">{timeAgo(r.createdAt)}</span>
            </div>
            <details className="mt-1 text-xs text-muted">
              <summary className="cursor-pointer select-none">Details</summary>
              <div className="mt-1.5 space-y-1">
                <ol className="mb-2 space-y-1 border-l border-line pl-3">
                  <li>
                    You asked: {runTitle(r.trigger) || "a message"} <span className="text-faint">· {channel}</span>
                  </li>
                  <li className={r.status === "failed" ? "text-bad" : undefined}>{r.status === "failed" ? `Didn't finish${why ? `: ${why}` : ""}` : r.status === "done" ? `Done${secs !== null ? ` in ${secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`}` : ""}` : runStatusLabel(r.status)}</li>
                </ol>
                <div>
                  Run id: <span className="font-mono break-all">{r.id}</span>
                </div>
                <div>Channel: {channel}</div>
                {r.trigger && <div className="whitespace-pre-wrap break-words max-h-32 overflow-y-auto rounded-lg bg-hover px-2 py-1.5">{r.trigger}</div>}
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}

// --- Connect ------------------------------------------------------------------

/** Another app as this agent: a token for a session that is already running, the address for apps that connect by URL, and the apps connected so far. */
function ConnectPanel({ agent }: { agent: FullAgent }) {
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <section className="space-y-2.5">
        <h3 className="px-1 text-[13px] font-semibold text-muted">A running session</h3>
        {token ? (
          <ConnectionInstructions token={token} harness={agent.harness} />
        ) : (
          <Button onClick={async () => setToken((await api<{ token: string }>("POST", `/api/agents/${agent.id}/token`)).token)}>Create token</Button>
        )}
      </section>
      <RemoteMcp agent={agent} />
    </div>
  );
}

/** The hub's remote MCP address, for Grok, ChatGPT and Claude connectors, and the apps connected as this agent. */
function RemoteMcp({ agent }: { agent: FullAgent }) {
  const info = useAccess();
  // a private address (Tailscale without its public door, or home Wi-Fi) is never offered: the apps' servers can't reach it
  const origin = connectorOrigin(info);
  const [apps, setApps] = useState<{ id: string; name: string; approvedBy: string | null; lastUsed: string | null; createdAt: string }[]>([]);
  const load = useCallback(() => {
    api<typeof apps>("GET", `/api/agents/${agent.id}/apps`).then(setApps, () => {});
  }, [agent.id]);
  useEffect(load, [load]);
  return (
    <section className="space-y-2.5">
      <h3 className="px-1 text-[13px] font-semibold text-muted">By URL</h3>
      {origin ? (
        <CopyBlock text={`${origin}/mcp`} />
      ) : (
        <p className="px-1 text-[13px] text-muted">
          {connectorBlocker(info)}{" "}
          <a className="text-ink underline underline-offset-2" href={href({ view: "settings", page: "devices" })}>
            Turn it on
          </a>
        </p>
      )}
      {apps.length > 0 && (
        <ul className={CARD}>
          {apps.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3.5 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium truncate">{a.name}</span>
                <span className="block text-xs text-muted truncate">{a.lastUsed ? `Used ${timeAgo(a.lastUsed)}` : `Added ${timeAgo(a.createdAt)}`}{a.approvedBy ? ` · ${a.approvedBy}` : ""}</span>
              </span>
              <Button
                variant="ghost"
                onClick={async () => {
                  await api("DELETE", `/api/agents/${agent.id}/apps/${a.id}`);
                  load();
                }}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
