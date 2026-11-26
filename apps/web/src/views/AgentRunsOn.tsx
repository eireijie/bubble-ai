import { useEffect, useState, type ReactNode } from "react";
import { Check, Cloud, KeyRound, Laptop, Loader2, Monitor, Plus, Power, Users } from "lucide-react";
import { harnessLabel, runsInVm, type Agent } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { go, href } from "../router.ts";
import { computerKindLabel, type DeviceInfo } from "../devices.ts";
import { useComputerMode } from "../computerMode.ts";
import { useFeature } from "../features.ts";
import { ScreenThumb } from "../components/Screen.tsx";
import { AddComputer, useComputerState } from "./ComputersView.tsx";
import { runsOnDevice } from "./AgentComputer.tsx";
import { CARD, Line, SELECT, Toggle } from "./AgentSections.tsx";
import { Button, cx, timeAgo } from "../components/ui.tsx";

/** One place it can run: a computer on a device, that device's own screen, or the device alone. */
export interface Place {
  key: string;
  title: string;
  sub?: string;
  icon: ReactNode;
  disabled?: boolean;
  /** the device it runs on there, when picking this moves it */
  nodeId: string | null;
  how: { kind: "shared" } | { kind: "own" } | { kind: "screen" } | { kind: "none" } | { kind: "computer"; id: string };
}

const isShared = (c: ComputerInfo, sharedId: string | null) => c.id === sharedId || !!(c.config as { shared?: boolean }).shared;

/** Which of the places below it is on now (null: nowhere yet). */
export function currentPlace(agent: Pick<Agent, "computerId" | "nodeId" | "settings">, computers: ComputerInfo[], sharedId: string | null): string | null {
  const c = computers.find((x) => x.id === agent.computerId);
  if (c) {
    if (isShared(c, sharedId)) return "shared";
    if (c.kind === "vm") return `own:${c.nodeId}`;
    if (c.kind === "device") return `screen:${c.nodeId}`;
    return `c:${c.id}`;
  }
  return agent.nodeId && agent.settings.headless ? `none:${agent.nodeId}` : null;
}

/**
 * Every place it can run, in one list: the shared computer, then for each of your devices its own
 * computer there, that device's screen, or the device with no computer. With one device the device's
 * name is left off. Advanced adds every other computer.
 */
export function places({ agent, nodes, computers, agents, sharedId, isOwner, advanced }: { agent: Pick<Agent, "id" | "computerId" | "nodeId" | "settings">; nodes: DeviceInfo[]; computers: ComputerInfo[]; agents: Pick<Agent, "id" | "handle">[]; sharedId: string | null; isOwner: boolean; advanced: boolean }): Place[] {
  const current = computers.find((c) => c.id === agent.computerId);
  const shared = computers.find((c) => isShared(c, sharedId));
  const others = (c: ComputerInfo) => agents.filter((a) => c.agents.includes(a.id) && a.id !== agent.id).map((a) => `@${a.handle}`);
  const out: Place[] = [];
  if (isOwner || (current && isShared(current, sharedId))) {
    const with_ = shared ? others(shared) : [];
    out.push({ key: "shared", title: "Shared computer", sub: with_.length ? `With ${with_.join(", ")}` : "One computer your agents share", icon: <Users size={16} />, disabled: !isOwner, nodeId: shared?.nodeId ?? null, how: { kind: "shared" } });
  }
  const devices = nodes.filter((n) => n.mine || n.shared || n.id === agent.nodeId);
  const one = devices.length === 1;
  for (const d of devices) {
    const on = one ? "" : ` on ${d.name}`;
    const off = d.online ? "" : " (offline)";
    const ownHere = current && current.kind === "vm" && !isShared(current, sharedId) && current.nodeId === d.id;
    if (d.capabilities?.vm.ok !== false || ownHere) out.push({ key: `own:${d.id}`, title: `Its own computer${on}`, sub: ownHere ? current!.name : `A new computer${one ? ` on ${d.name}` : ""}${off}`, icon: <Monitor size={16} />, nodeId: d.id, how: { kind: "own" } });
    const screenHere = current?.kind === "device" && current.nodeId === d.id;
    if (d.mine || screenHere) {
      const screen = d.capabilities?.screen;
      out.push({ key: `screen:${d.id}`, title: one ? "My screen" : `${d.name}'s screen`, sub: screen?.off ? `Off at ${d.name}` : screen?.ok === false ? screen.detail : `Uses ${d.name} as you see it`, icon: <Laptop size={16} />, disabled: !screenHere && screen?.ok === false, nodeId: d.id, how: { kind: "screen" } });
    }
    out.push({ key: `none:${d.id}`, title: one ? "No computer" : `${d.name}, no computer`, sub: `Answers from ${d.name}${off}, no screen of its own`, icon: <Power size={16} />, nodeId: d.id, how: { kind: "none" } });
  }
  const listed = new Set(out.map((p) => p.key));
  // any other computer: the one it's on when the list above doesn't have it, and in Advanced every one there is
  for (const c of computers) {
    if (isShared(c, sharedId)) continue;
    const key = currentPlace({ ...agent, computerId: c.id }, computers, sharedId)!;
    if (c.id === agent.computerId ? listed.has(key) : !advanced || (c.kind === "device" && listed.has(key))) continue;
    const users = others(c);
    out.push({ key: `c:${c.id}`, title: c.name, sub: `${computerKindLabel(c, nodes)}${users.length ? ` · ${users.join(", ")}` : ""}`, icon: c.kind === "orgo" ? <Cloud size={16} /> : c.kind === "vm" ? <Monitor size={16} /> : <Laptop size={16} />, nodeId: c.nodeId ?? null, how: { kind: "computer", id: c.id } });
    listed.add(`c:${c.id}`);
  }
  return out;
}

/**
 * Runs on: where the agent works, as one list to pick from (what is missing first, with its fix).
 * Under it, only what goes with the pick: its screen, the AI signing in there, where the AI runs
 * (Advanced), the computers of yours it may use, and teaching it a task.
 */
export function RunsOn({ agent, nodes, problem, fix }: { agent: Agent; nodes: DeviceInfo[]; problem?: string | null; fix?: { href: string; action: string } | null }) {
  const mode = useComputerMode();
  const teachOn = useFeature("teach");
  const computers = useStore((s) => s.computers);
  const agents = useStore((s) => s.agents);
  const isOwner = useStore((s) => s.me?.role === "owner");
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!mode.loaded) return null;
  const current = computers.find((c) => c.id === agent.computerId);
  const list = places({ agent, nodes, computers, agents, sharedId: mode.sharedComputerId, isOwner, advanced: mode.advanced });
  const at = currentPlace(agent, computers, mode.sharedComputerId);
  const now = current && !list.some((p) => p.key === at) ? `c:${current.id}` : at;

  const refresh = () => Promise.all([refreshAgents(), useStore.getState().refreshComputers()]);
  const patch = (body: object) => api("PATCH", `/api/agents/${agent.id}`, body);
  const pick = async (p: Place) => {
    if (p.key === now) return;
    setBusy(p.key);
    setError(null);
    try {
      if (p.nodeId && p.nodeId !== agent.nodeId && p.how.kind !== "shared" && p.how.kind !== "computer") await patch({ nodeId: p.nodeId });
      const how = p.how;
      if (how.kind === "shared") await patch({ computerId: (await api<ComputerInfo>("POST", "/api/computers/shared")).id });
      else if (how.kind === "computer") await patch({ computerId: how.id });
      else if (how.kind === "none") await patch({ computerId: null, settings: { headless: true } });
      else if (how.kind === "screen") {
        const there = computers.find((c) => c.kind === "device" && c.nodeId === p.nodeId);
        await patch({ computerId: (there ?? (await api<ComputerInfo>("POST", "/api/computers", { kind: "device", nodeId: p.nodeId }))).id });
      } else {
        // its own: one it had before on that device, else a new one; a harness that comes with the computer moves in with it
        const mine = computers.find((c) => c.kind === "vm" && !isShared(c, mode.sharedComputerId) && c.agents.length === 0 && c.nodeId === p.nodeId && c.name === `${agent.name}'s computer`);
        const c = mine ?? (await api<ComputerInfo>("POST", "/api/computers", { kind: "vm", nodeId: p.nodeId, name: `${agent.name}'s computer` }));
        await patch({ computerId: c.id, ...(runsInVm(agent.harness) && !agent.settings.runIn ? { settings: { runIn: "computer" } } : {}) });
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {current && <ScreenTile computer={current} />}
      <div role="radiogroup" aria-label="Runs on" className={CARD}>
        {problem && (
          <Line grow label={problem} warn>
            {fix && (
              <a href={fix.href} className="shrink-0 font-medium text-ink underline underline-offset-2">
                {fix.action}
              </a>
            )}
          </Line>
        )}
        {list.map((p) => {
          const on = p.key === now;
          return (
            <button key={p.key} type="button" role="radio" aria-checked={on} disabled={p.disabled || !!busy} onClick={() => void pick(p)} className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent">
              <span className="flex shrink-0 text-muted">{busy === p.key ? <Loader2 size={16} className="animate-spin" /> : p.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.title}</span>
                {p.sub && <span className="block truncate text-[12.5px] text-muted">{p.sub}</span>}
              </span>
              <Check size={15} className={cx("shrink-0", !on && "invisible")} aria-hidden />
            </button>
          );
        })}
        {list.length === 0 && <Line label="No devices yet" to={href({ view: "computers", computerId: null })} />}
        {mode.advanced && <Line label="Add a computer" icon={<Plus size={16} />} onClick={() => setAdding(true)} />}
      </div>
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
      <AiPlace agent={agent} device={nodes.find((n) => n.id === agent.nodeId)} advanced={mode.advanced} />
      <UseMyComputers agent={agent} nodes={nodes} teach={teachOn && current ? href({ view: "computers", computerId: current.id, teach: agent.id }) : null} />
      {adding && (
        <AddComputer
          devices={nodes}
          nodeId={agent.nodeId}
          defaultName={`${agent.name}'s desk`}
          onClose={() => setAdding(false)}
          onCreated={(c) => {
            setAdding(false);
            void pick({ key: `c:${c.id}`, title: c.name, icon: null, nodeId: c.nodeId ?? null, how: { kind: "computer", id: c.id } });
          }}
        />
      )}
    </div>
  );
}

/** Its screen, small: click to watch (a computer that is off turns on first). */
function ScreenTile({ computer }: { computer: ComputerInfo }) {
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
      <p className="px-1 text-[13px] text-muted">{off ? (computer.activity ? `Last used ${timeAgo(computer.activity.at)}` : "Starts when needed") : state.label}</p>
    </div>
  );
}

interface HarnessPlace {
  possible: boolean;
  inComputer: boolean;
  signedIn: boolean | null;
  computerId: string | null;
}

/**
 * What goes with a computer for its AI: signing in there when it isn't (always shown, it's a fix),
 * and, in Advanced, whether the AI runs inside the computer or on the device.
 */
function AiPlace({ agent, device, advanced }: { agent: Agent; device: DeviceInfo | undefined; advanced: boolean }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [info, setInfo] = useState<HarnessPlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = harnessLabel(agent.harness);
  useEffect(() => {
    api<HarnessPlace>("GET", `/api/agents/${agent.id}/harness`).then(setInfo, () => setInfo(null));
  }, [agent.id, agent.computerId, agent.settings.runIn, agent.harness]);
  if (!info || !info.possible || !runsOnDevice(agent.harness) || !device) return null;
  const needsSignIn = info.inComputer && info.signedIn === false;
  if (!advanced && !needsSignIn) return null;

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
    <div className={CARD}>
      {advanced && (
        <Line label={`${label} runs`}>
          <select aria-label={`Where ${label} runs`} className={SELECT} disabled={busy} value={info.inComputer ? "computer" : "device"} onChange={(e) => void set(e.target.value as "computer" | "device")}>
            <option value="computer">Inside its computer</option>
            <option value="device">On {device.name}</option>
          </select>
        </Line>
      )}
      {needsSignIn && (
        <Line grow label={`${label} isn't signed in`} warn>
          <Button variant="primary" className="h-8!" disabled={busy} onClick={signIn}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Sign in
          </Button>
        </Line>
      )}
      {error && <p className="px-3.5 py-2 text-[13px] text-bad">{error}</p>}
    </div>
  );
}

/**
 * Use my computers: which of your own computers it may use when a task needs your apps or sign-ins
 * there (Off, Ask first, Allowed). Not where it runs: a permission. Teach a task sits with it.
 */
function UseMyComputers({ agent, nodes, teach }: { agent: Agent; nodes: DeviceInfo[]; teach: string | null }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = nodes.filter((n) => n.mine);
  const allowed = agent.settings.useDevices ?? {};
  const on = mine.some((n) => allowed[n.id]);
  const [open, setOpen] = useState(on);
  useEffect(() => setOpen(on), [on]);
  if (!mine.length && !teach) return null;
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
    <div className={CARD}>
      {mine.length > 0 && (
        <Line label="Use my computers">
          {error && (
            <span className="truncate text-bad" title={error}>
              {error}
            </span>
          )}
          <Toggle label="Use my computers" on={open} disabled={busy} onChange={toggle} />
        </Line>
      )}
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
      {teach && <Line label="Teach a task" to={teach} />}
    </div>
  );
}
