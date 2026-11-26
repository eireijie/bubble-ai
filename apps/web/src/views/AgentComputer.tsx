import { useEffect, useState } from "react";
import { CalendarClock, Cloud, FileText, KeyRound, Laptop, Loader2, Lock, Monitor, MoreHorizontal, Play, Plus, Power, Trash2 } from "lucide-react";
import { describeCron, harnessInfo, harnessLabel, nextRun, runsInVm, type Agent, type Routine } from "@wisp/core";
import { api } from "../api.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { go, href } from "../router.ts";
import { agentReadiness, computerKindLabel, computerSummary, useDevices, type DeviceInfo } from "../devices.ts";
import { AddComputer, useComputerState } from "./ComputersView.tsx";
import { ScreenThumb } from "../components/Screen.tsx";
import { useComputerMode } from "../computerMode.ts";
import { useFeature } from "../features.ts";
import { CARD, Line, LineHead, SELECT, ShowAll, Toggle } from "./AgentSections.tsx";
import { Button, Field, Input, Menu, Modal, Textarea, cx, timeAgo } from "../components/ui.tsx";
import { MoreOptions } from "../components/MoreOptions.tsx";

/** Harnesses Wisp starts on a device (natively or over ACP), as opposed to ones that join through MCP. */
export function runsOnDevice(harness: string) {
  return harness.startsWith("acp:") || (harnessInfo(harness)?.protocol ?? "mcp") !== "mcp";
}

// --- Works on -------------------------------------------------------------------------------------

/**
 * Where the agent works, as rows: what is missing (in the warning colour, with the fix beside it),
 * its computer (the shared one or its own), the device that runs it, and which of your computers
 * it may use. Every other choice (where its AI runs, another computer, none at all) is behind
 * "Show all", which starts open for people who pick where agents run (Settings → Devices).
 */
export function WorksOn({ agent, nodes, problem, fix, all }: { agent: Agent; nodes: DeviceInfo[]; problem?: string | null; fix?: { href: string; action: string } | null; all?: boolean }) {
  const mode = useComputerMode();
  const teachOn = useFeature("teach");
  const computers = useStore((s) => s.computers);
  const agents = useStore((s) => s.agents);
  if (!mode.loaded) return null;
  const current = computers.find((c) => c.id === agent.computerId);
  const device = nodes.find((n) => n.id === agent.nodeId);
  const sharing = current && current.agents.length > 1 ? agents.filter((a) => current.agents.includes(a.id) && a.id !== agent.id).map((a) => `@${a.handle}`).join(", ") : "";
  return (
    <div className="space-y-3">
      {current && <ScreenTile computer={current} sharing={sharing} />}
      <div className={CARD}>
        {problem && (
          <Line grow label={problem} warn>
            {fix && (
              <a href={fix.href} className="shrink-0 font-medium text-ink underline underline-offset-2">
                {fix.action}
              </a>
            )}
          </Line>
        )}
        <ComputerLine agent={agent} nodes={nodes} current={current} advanced={mode.advanced} sharedId={mode.sharedComputerId} />
        <RunsOnLine agent={agent} nodes={nodes} />
        <UseMyComputers agent={agent} nodes={nodes} />
        {teachOn && current && <Line label="Teach a task" to={href({ view: "computers", computerId: current.id, teach: agent.id })} />}
        <ShowAll open={mode.advanced || all}>
          <RunsWhere agent={agent} device={device} />
          <MoveTo agent={agent} nodes={nodes} />
        </ShowAll>
      </div>
    </div>
  );
}

/** Its screen, small: click to watch (a computer that is off turns on first). One line under it says what it is doing. */
function ScreenTile({ computer, sharing }: { computer: ComputerInfo; sharing: string }) {
  const state = useComputerState(computer);
  const off = computer.kind === "vm" && computer.status === "stopped";
  return (
    <div className="max-w-[360px] space-y-1.5">
      <a href={href({ view: "computers", computerId: computer.id })} aria-label={off ? `Turn on and watch ${computer.name}` : `Watch ${computer.name}`} className="block overflow-hidden rounded-[14px]">
        {off ? (
          <div className="grid aspect-[16/10] place-items-center bg-neutral-800 text-white/85">
            <span className="flex flex-col items-center gap-1.5">
              <Power size={22} strokeWidth={1.6} />
              <span className="text-[13px] font-semibold">Off</span>
            </span>
          </div>
        ) : (
          <ScreenThumb computer={computer} refreshMs={3000} />
        )}
      </a>
      <p className="px-1 text-[13px] text-muted">
        {off ? (computer.activity ? `Last used ${timeAgo(computer.activity.at)}` : "Starts when needed") : state.label}
        {sharing && ` · shared with ${sharing}`}
      </p>
    </div>
  );
}

/** Which computer it works on. Simple: the shared one or its own, picked here. Otherwise the row says which, and "Show all" has every choice. */
function ComputerLine({ agent, nodes, current, advanced, sharedId }: { agent: Agent; nodes: DeviceInfo[]; current: ComputerInfo | undefined; advanced: boolean; sharedId: string | null }) {
  const computers = useStore((s) => s.computers);
  const refreshAgents = useStore((s) => s.refreshAgents);
  const isOwner = useStore((s) => s.me?.role === "owner");
  const [busy, setBusy] = useState<"shared" | "own" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onShared = !!current && (current.id === sharedId || !!(current.config as { shared?: boolean }).shared);

  const move = async (to: "shared" | "own") => {
    setBusy(to);
    setError(null);
    try {
      let target: ComputerInfo;
      if (to === "shared") target = await api<ComputerInfo>("POST", "/api/computers/shared");
      else {
        // its own: one it already has from before, else a new one beside the shared computer
        const nodeId = current?.nodeId ?? agent.nodeId;
        const mine = computers.find((c) => c.kind === "vm" && c.id !== sharedId && !(c.config as { shared?: boolean }).shared && c.agents.length === 0 && c.nodeId === nodeId && c.name === `${agent.name}'s computer`);
        target = mine ?? (await api<ComputerInfo>("POST", "/api/computers", { kind: "vm", nodeId, name: `${agent.name}'s computer` }));
      }
      await api("PATCH", `/api/agents/${agent.id}`, { computerId: target.id });
      await Promise.all([refreshAgents(), useStore.getState().refreshComputers()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const none = agent.settings.headless ? "No computer" : "None yet";
  if (advanced || (current && current.kind !== "vm")) return <Line label="Computer" value={current ? computerSummary(current, nodes, advanced) : none} />;
  return (
    <Line label="Computer">
      {error && (
        <span className="truncate text-bad" title={error}>
          {error}
        </span>
      )}
      {busy && <Loader2 size={14} className="shrink-0 animate-spin" />}
      <select aria-label="Computer" className={SELECT} disabled={!!busy} value={!current ? "" : onShared ? "shared" : "own"} onChange={(e) => e.target.value && void move(e.target.value as "shared" | "own")}>
        {!current && (
          <option value="" disabled>
            {none}
          </option>
        )}
        {(isOwner || onShared) && (
          <option value="shared" disabled={!isOwner}>
            Shared computer
          </option>
        )}
        <option value="own" disabled={!current && !agent.nodeId}>
          Its own computer
        </option>
      </select>
    </Line>
  );
}

/** The device that runs its AI whenever it is asked something. */
function RunsOnLine({ agent, nodes }: { agent: Agent; nodes: DeviceInfo[] }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const saved = agent.nodeId ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (nodeId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { nodeId: nodeId || null });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Line label="Runs on">
      {error && (
        <span className="truncate text-bad" title={error}>
          {error}
        </span>
      )}
      <select aria-label="Runs on" className={SELECT} disabled={busy} value={saved} onChange={(e) => void pick(e.target.value)}>
        <option value="">No device</option>
        {nodes
          .filter((n) => n.mine || n.shared || n.id === saved)
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
              {n.online ? "" : " (offline)"}
            </option>
          ))}
      </select>
    </Line>
  );
}

/**
 * Use my computers: which of your own computers this agent may use, when a task needs your apps or
 * sign-ins there. Off, Ask first (a card each task) or Allowed (it tells you after). Only your devices.
 */
function UseMyComputers({ agent, nodes }: { agent: Agent; nodes: DeviceInfo[] }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = nodes.filter((n) => n.mine);
  const allowed = agent.settings.useDevices ?? {};
  const on = mine.some((n) => allowed[n.id]);
  const [open, setOpen] = useState(on);
  useEffect(() => setOpen(on), [on]);
  if (!mine.length) return null;
  const screenOn = (n: DeviceInfo) => !!n.capabilities?.screen.ok && !n.capabilities.screen.off;

  const save = async (next: Record<string, "ask" | "tell">) => {
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { settings: { useDevices: next } });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (nodeId: string, how: "off" | "ask" | "tell") => {
    const next = { ...allowed };
    if (how === "off") delete next[nodeId];
    else next[nodeId] = how;
    void save(next);
  };
  const toggle = (value: boolean) => {
    setOpen(value);
    if (!value && on) {
      const next = { ...allowed };
      for (const n of mine) delete next[n.id];
      void save(next);
    }
  };

  return (
    <>
      <Line label="Use my computers">
        {error && (
          <span className="truncate text-bad" title={error}>
            {error}
          </span>
        )}
        <Toggle label="Use my computers" on={open} disabled={busy} onChange={toggle} />
      </Line>
      {open &&
        mine.map((n) =>
          screenOn(n) ? (
            <Line key={n.id} label={n.name} icon={<Laptop size={16} />}>
              <div role="radiogroup" aria-label={n.name} className="flex shrink-0 rounded-lg bg-chip p-0.5">
                {(
                  [
                    ["off", "Off"],
                    ["ask", "Ask first"],
                    ["tell", "Allowed"],
                  ] as const
                ).map(([how, label]) => {
                  const picked = (allowed[n.id] ?? "off") === how;
                  return (
                    <button key={how} role="radio" aria-checked={picked} disabled={busy} onClick={() => !picked && set(n.id, how)} className={cx("h-7 rounded-md px-2.5 text-xs", picked ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink")}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </Line>
          ) : (
            <Line key={n.id} label={n.name} icon={<Laptop size={16} />} value={n.capabilities?.screen.ok === false && !n.capabilities.screen.off ? "No screen" : "Screen is off there"} />
          ),
        )}
    </>
  );
}

interface HarnessPlace {
  possible: boolean;
  inComputer: boolean;
  signedIn: boolean | null;
  computerId: string | null;
}

/**
 * Where the agent's harness runs: inside its VM (its shell, files and browser all stay in there,
 * and anyone can ask it for things) or directly on the device (it can reach the device's files).
 * And, when it runs inside its computer and isn't signed in there yet, the one button that fixes it.
 */
function RunsWhere({ agent, device }: { agent: Agent; device: DeviceInfo | undefined }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [info, setInfo] = useState<HarnessPlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = harnessLabel(agent.harness);
  const load = () => api<HarnessPlace>("GET", `/api/agents/${agent.id}/harness`).then(setInfo, () => setInfo(null));
  useEffect(() => {
    load();
  }, [agent.id, agent.computerId, agent.settings.runIn, agent.harness]);
  if (!info || !runsOnDevice(agent.harness) || !device) return null;

  const set = async (runIn: "computer" | "device") => {
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { settings: { runIn } });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ computerId: string }>("POST", `/api/agents/${agent.id}/signin`);
      go({ view: "computers", computerId: r.computerId });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!info.possible ? (
        <Line label={`${label} runs`} value={`On ${device.name}`} />
      ) : (
        <Line label={`${label} runs`}>
          {error && (
            <span className="truncate text-bad" title={error}>
              {error}
            </span>
          )}
          <select aria-label={`Where ${label} runs`} className={SELECT} disabled={busy} value={info.inComputer ? "computer" : "device"} onChange={(e) => void set(e.target.value as "computer" | "device")}>
            <option value="computer">Inside its computer</option>
            <option value="device">On {device.name}</option>
          </select>
        </Line>
      )}
      {info.possible && info.inComputer && info.signedIn === false && (
        <Line grow label={`${label} isn't signed in`} warn>
          <Button variant="primary" className="h-8!" disabled={busy} onClick={signIn}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Sign in
          </Button>
        </Line>
      )}
    </>
  );
}

/** Every other computer it could work on: a new one, your own screen, one that exists, another kind, or none. */
function MoveTo({ agent, nodes }: { agent: Agent; nodes: DeviceInfo[] }) {
  const computers = useStore((s) => s.computers);
  const agents = useStore((s) => s.agents);
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = computers.find((c) => c.id === agent.computerId);
  const device = nodes.find((n) => n.id === agent.nodeId);
  const headless = !current && !!agent.settings.headless;

  const use = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await Promise.all([refreshAgents(), useStore.getState().refreshComputers()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const assign = (c: { id: string }) => api("PATCH", `/api/agents/${agent.id}`, { computerId: c.id });
  const quickVm = () =>
    use("vm", async () => {
      const c = await api<ComputerInfo>("POST", "/api/computers", { kind: "vm", nodeId: agent.nodeId, name: `${agent.name}'s desk`, cpus: 2, memoryGb: 4 });
      // a harness that comes with the VM moves in with it, unless someone already chose where it runs
      await api("PATCH", `/api/agents/${agent.id}`, { computerId: c.id, ...(runsInVm(agent.harness) && !agent.settings.runIn ? { settings: { runIn: "computer" } } : {}) });
    });
  const quickScreen = () => use("screen", async () => assign(await api<ComputerInfo>("POST", "/api/computers", { kind: "device", nodeId: agent.nodeId })));
  const goHeadless = () => use("headless", () => api("PATCH", `/api/agents/${agent.id}`, { computerId: null, settings: { headless: true } }));

  const others = computers.filter((c) => c.id !== agent.computerId);
  return (
    <>
      <LineHead>Move to</LineHead>
      {device && device.capabilities?.vm.ok && <Move icon={<Monitor size={16} />} title={`New computer on ${device.name}`} busy={busy === "vm"} onClick={quickVm} />}
      {device?.mine && (
        <Move
          icon={<Lock size={16} />}
          title="My own screen"
          value={device.capabilities?.screen.off ? `Off at ${device.name}` : device.capabilities?.screen.ok === false ? device.capabilities.screen.detail : device.name}
          hint={device.capabilities?.screen.off ? `Turn it on at ${device.name} with: wisp node screen on` : undefined}
          disabled={device.capabilities?.screen.ok === false || others.some((c) => c.kind === "device" && c.nodeId === device.id) || current?.kind === "device"}
          busy={busy === "screen"}
          onClick={quickScreen}
        />
      )}
      {others.map((c) => (
        <Move key={c.id} icon={c.kind === "orgo" ? <Cloud size={16} /> : c.kind === "vm" ? <Monitor size={16} /> : <Laptop size={16} />} title={c.name} value={`${computerKindLabel(c, nodes)}${c.agents.length ? ` · ${agents.filter((a) => c.agents.includes(a.id)).map((a) => `@${a.handle}`).join(", ")}` : ""}`} busy={busy === c.id} onClick={() => use(c.id, () => assign(c))} />
      ))}
      <Move icon={<Plus size={16} />} title="Another computer" onClick={() => setAdding(true)} />
      {!headless && <Move icon={<Power size={16} />} title="No computer" disabled={!!busy} busy={busy === "headless"} onClick={goHeadless} />}
      {error && <p className="px-3.5 py-2 text-[13px] text-bad">{error}</p>}
      {adding && (
        <AddComputer
          devices={nodes}
          nodeId={agent.nodeId}
          defaultName={`${agent.name}'s desk`}
          onClose={() => setAdding(false)}
          onCreated={(c) => {
            setAdding(false);
            use(c.id, () => assign(c));
          }}
        />
      )}
    </>
  );
}

/** One place to move to: a row that acts when clicked. */
function Move({ icon, title, value, hint, onClick, busy, disabled }: { icon: React.ReactNode; title: string; value?: string; hint?: string; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled || busy} onClick={onClick} title={hint} className="flex min-h-[46px] w-full items-center gap-3 px-3.5 py-1.5 text-left text-[14px] hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent">
      <span className="flex shrink-0 text-muted">{busy ? <Loader2 size={16} className="animate-spin" /> : icon}</span>
      <span className="min-w-0 max-w-[62%] shrink-0 truncate font-medium">{title}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[13px] text-muted">{value}</span>
    </button>
  );
}

// --- Routines ---------------------------------------------------------------------------------------

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Longest name the hub accepts for a routine. */
const NAME_MAX = 80;

/** A short routine name from what the person wants done: the first sentence, cut at a word. */
export function routineName(name: string, result: string): string {
  const given = name.trim();
  if (given) return given.slice(0, NAME_MAX);
  const first = (result.trim().split(/[.!?\n]/)[0] ?? "").replace(/\s+/g, " ").trim();
  if (first.length <= 50) return first;
  const cut = first.slice(0, 50);
  return (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trim() + "…";
}

/** The steps text saved with a routine: the goal first, then any steps the person wrote. */
export function routineSteps(result: string, steps: string): string {
  const goal = result.trim();
  const body = steps.trim();
  if (!goal) return steps;
  return body ? `Goal: ${goal}\n\n${body}` : `Goal: ${goal}\n\nNo steps were written. Work out the steps yourself, and adapt if something looks different next time.`;
}

/** Why a new routine can't be saved yet (null = fine). The hub needs a name of 1 to 80 characters. */
export function routineProblem(name: string, result: string): string | null {
  if (!result.trim()) return "Say what should happen.";
  if (!routineName(name, result)) return "Give the routine a name.";
  return null;
}

/** What the agent's schedules are waiting for: its device's name (or "a device"), or null when the device is connected or unknown. */
export function routinesWaitingFor(agent: Pick<Agent, "id" | "nodeId" | "harness" | "settings" | "computerId">, devices: DeviceInfo[] | null): string | null {
  if (agentReadiness(agent, devices).ready) return null;
  if (!agent.nodeId) return "a device";
  const device = devices?.find((d) => d.id === agent.nodeId);
  return device && (!device.online || device.paused) ? device.name : null;
}

/** Tasks the agent does again, written down, some on a schedule. (Teaching a task makes a skill, under Can use.) */
export function RoutinesPanel({ agent, active }: { agent: Agent; active: boolean }) {
  const version = useStore((s) => s.routinesVersion);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const waitingFor = routinesWaitingFor(agent, useDevices());
  const [writing, setWriting] = useState(false);
  const [scheduling, setScheduling] = useState<Routine | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (active) api<Routine[]>("GET", `/api/routines?agent=${agent.id}`).then(setRoutines, () => setRoutines([]));
  }, [active, agent.id, version]);

  const run = async (r: Routine) => {
    setError(null);
    try {
      const res = await api<{ channelId: string }>("POST", `/api/routines/${r.id}/run`);
      await useStore.getState().refreshChannels();
      go({ view: "chat", channelId: res.channelId, threadId: null });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setWriting(true)}>
          <Plus size={15} /> New
        </Button>
      </div>
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
      {routines === null ? (
        <p className="px-1 text-[13px] text-muted">Loading…</p>
      ) : routines.length === 0 ? (
        <p className="px-1 text-[13px] text-muted">None yet</p>
      ) : (
        <div className={CARD}>
          {routines.map((r) => {
            const next = r.schedule && r.enabled && r.status === "ready" ? nextRun(r.schedule, r.timezone) : null;
            // one line: its state when it isn't simply on, when it runs, and what it is waiting for
            const when = r.schedule ? `${describeCron(r.schedule)}${r.timezone !== TZ ? ` (${r.timezone})` : ""}` : "When asked";
            const line = [!r.enabled ? "Paused" : null, when, next && waitingFor ? `waits for ${waitingFor}` : null].filter(Boolean).join(" · ");
            const details = [next ? `Next ${next.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : null, r.lastRunAt ? `last asked ${timeAgo(r.lastRunAt)}` : null, r.lastCompletedAt ? `last done ${timeAgo(r.lastCompletedAt)}` : null].filter(Boolean).join(" · ");
            return (
              <div key={r.id} className="flex min-h-[54px] items-center gap-2 px-3.5 py-1.5 text-[14px]">
                <button type="button" onClick={() => setScheduling(r)} title={details || undefined} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-[13px] text-muted">{line}</span>
                </button>
                <Button className="h-8!" disabled={r.status !== "ready"} onClick={() => run(r)}>
                  <Play size={14} /> Run now
                </Button>
                <Menu
                  align="right"
                  items={[
                    { label: "Steps", icon: <FileText size={15} />, onSelect: () => go({ view: "vault", path: r.notePath }) },
                    { label: "Schedule", icon: <CalendarClock size={15} />, onSelect: () => setScheduling(r) },
                    "divider",
                    {
                      label: "Delete",
                      icon: <Trash2 size={15} />,
                      danger: true,
                      onSelect: async () => {
                        if (!confirm(`Delete the routine "${r.name}"? Its steps stay in memory.`)) return;
                        await api("DELETE", `/api/routines/${r.id}`);
                      },
                    },
                  ]}
                  trigger={(open, toggle) => (
                    <button type="button" onClick={toggle} aria-expanded={open} aria-label={`More for ${r.name}`} className="circle circle-sm shrink-0">
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                />
              </div>
            );
          })}
        </div>
      )}
      {writing && <WriteRoutine agent={agent} onClose={() => setWriting(false)} />}
      {scheduling && <ScheduleDialog routine={scheduling} onClose={() => setScheduling(null)} />}
    </div>
  );
}

function WriteRoutine({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [result, setResult] = useState("");
  const [name, setName] = useState("");
  const [steps, setSteps] = useState("");
  const [schedule, setSchedule] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`New routine for ${agent.name}`} onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const problem = routineProblem(name, result);
          if (problem) return setError(problem);
          try {
            await api("POST", "/api/routines", { agentId: agent.id, name: routineName(name, result), steps: routineSteps(result, steps), schedule, timezone: TZ });
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <Field label="What should happen?">
          <Textarea rows={3} value={result} onChange={(e) => setResult(e.target.value)} placeholder="Send me three dinner ideas with a shopping list" required />
        </Field>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <MoreOptions about="name and steps">
          <div className="space-y-4">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dinner ideas" />
            </Field>
            <Field label="Steps">
              <Textarea rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="1. Look at what is in the fridge" />
            </Field>
          </div>
        </MoreOptions>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary">Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleDialog({ routine, onClose }: { routine: Routine; onClose: () => void }) {
  const [schedule, setSchedule] = useState(routine.schedule);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`When does "${routine.name}" run?`} onClose={onClose}>
      <div className="space-y-4">
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> On
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api("PATCH", `/api/routines/${routine.id}`, { schedule, enabled, timezone: TZ });
                onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Preset = "none" | "daily" | "weekdays" | "weekly" | "hourly" | "custom";

function presetOf(cron: string | null): { preset: Preset; time: string; day: number } {
  const m = cron?.match(/^(\d+) (\d+) \* \* (\*|1-5|\d)$/);
  if (!cron) return { preset: "none", time: "09:00", day: 1 };
  if (cron === "0 * * * *") return { preset: "hourly", time: "09:00", day: 1 };
  if (!m) return { preset: "custom", time: "09:00", day: 1 };
  const time = `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  return m[3] === "*" ? { preset: "daily", time, day: 1 } : m[3] === "1-5" ? { preset: "weekdays", time, day: 1 } : { preset: "weekly", time, day: Number(m[3]) };
}

/** Plain choices ("every weekday at 9:00") that write a cron schedule; custom cron for the rest. */
function ScheduleEditor({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const init = presetOf(value);
  const [preset, setPreset] = useState<Preset>(init.preset);
  // an existing custom schedule stays in plain view; a new one is typed under More options
  const [startedCustom] = useState(init.preset === "custom");
  const [time, setTime] = useState(init.time);
  const [day, setDay] = useState(init.day);
  const [custom, setCustom] = useState(value ?? "0 9 * * 1-5");
  const [h, m] = time.split(":").map(Number);
  const at = `${m || 0} ${h || 0}`;
  const cron = preset === "none" ? null : preset === "hourly" ? "0 * * * *" : preset === "daily" ? `${at} * * *` : preset === "weekdays" ? `${at} * * 1-5` : preset === "weekly" ? `${at} * * ${day}` : custom.trim();
  useEffect(() => {
    onChange(cron);
  }, [cron]);
  const selectCls = "h-9 rounded-lg border border-line bg-panel px-2 text-sm";
  // a custom schedule stays out of the list, but one that is already set is never hidden.
  const customInput = (
    <label className="flex flex-col gap-1 text-xs text-muted">
      Custom schedule (cron)
      <Input
        className="w-48 font-mono"
        value={custom}
        onChange={(e) => {
          setCustom(e.target.value);
          setPreset("custom");
        }}
        placeholder="0 9 * * 1-5"
      />
    </label>
  );
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Schedule</span>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-xs text-muted">
          How often
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={selectCls}>
            <option value="none">Only when someone runs it</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Every week</option>
            <option value="hourly">Every hour</option>
            {preset === "custom" && <option value="custom">Custom schedule</option>}
          </select>
        </label>
        {preset === "weekly" && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Day
            <select value={day} onChange={(e) => setDay(Number(e.target.value))} className={selectCls}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  on {d}
                </option>
              ))}
            </select>
          </label>
        )}
        {["daily", "weekdays", "weekly"].includes(preset) && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={selectCls} />
          </label>
        )}
        {preset === "custom" && startedCustom && customInput}
      </div>
      {!startedCustom && <MoreOptions about="a custom schedule">{customInput}</MoreOptions>}
      {cron && <p className="text-xs text-muted">{`${describeCron(cron)}, in ${TZ}`}</p>}
    </div>
  );
}
