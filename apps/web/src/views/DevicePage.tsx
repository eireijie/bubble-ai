import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy, Download, ExternalLink, Link2, MoreHorizontal, Plus, RefreshCw, Smartphone } from "lucide-react";
import { HARNESSES, OwnRemoteDesktop, REMOTE_APPS, REMOTE_APP_IDS, formatRustdeskId, harnessLabel, remoteDesktopLink, runsInVm, type Actor, type Agent, type DeviceRole, type HarnessInfo, type RemoteApp } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { go, href } from "../router.ts";
import { isSharedComputer, useDevices } from "../devices.ts";
import { useFeature } from "../features.ts";
import { CreateAgent } from "./CreateAgent.tsx";
import { HowToInstall } from "./settings/runtimes.tsx";
import { HarnessLogo } from "../components/HarnessLogo.tsx";
import { Toggle } from "./settings/parts.tsx";
import { SheetHead, StartProblem, TilePicture, startComputer, toneText, useAddFlow, usePhones, useTileStatus } from "./ComputersParts.tsx";
import { ASK_LEVELS, activityDot, askLevel, screenOffText, screenSwitch, sizeLine, updateExists, watchBlock, watchHref, type HubVersion, type SheetTarget } from "./computerState.ts";
import { connectionLine, type NodeInfo } from "./deviceBits.tsx";
import { AgentAvatar, Button, CopyBlock, Field, Input, Menu, Modal, cx, timeAgo } from "../components/ui.tsx";

const CARD = "overflow-hidden rounded-[14px] bg-card divide-y divide-line";
const ROW = "flex min-h-[46px] w-full items-center gap-3 px-3.5 text-left text-[14px]";

/** A row that opens something (a sheet in place, another computer: it has a chevron), or does something right away (`act`: no chevron). */
function Row({ label, value, onClick, href: to, disabled, act }: { label: string; value?: ReactNode; onClick?: () => void; href?: string; disabled?: boolean; act?: boolean }) {
  const inner = (
    <>
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[13px] text-muted">{value}</span>
      {!act && <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />}
    </>
  );
  return to ? (
    <a href={to} className={cx(ROW, "hover:bg-hover")}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} disabled={disabled} className={cx(ROW, "hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent")}>
      {inner}
    </button>
  );
}

/** A plain fact about the computer: nothing to open. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={ROW}>
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[13px] text-muted">{value}</span>
    </div>
  );
}

/** A switch with its name; `value` says what a switch that can't be changed here is set to. */
function SwitchRow({ label, on, onChange, disabled, value }: { label: string; on: boolean; onChange?: (on: boolean) => void; disabled?: boolean; value?: string }) {
  return (
    <div className={ROW}>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {value && <span className="shrink-0 text-[13px] text-muted">{value}</span>}
      <Toggle on={on} label={label} disabled={disabled || !onChange} onChange={(v) => onChange?.(v)} />
    </div>
  );
}

type Sub = "ask" | "more" | "tools" | "agents" | "activity" | "remote";
const SUB_TITLE: Record<Sub, string> = { ask: "Ask me", more: "More", tools: "AI tools", agents: "Agents", activity: "Activity", remote: "Remote desktop" };

/**
 * What opens beside the grid: a computer's sheet. Its screen, Watch and Take over, then one card
 * (Run commands and files, See and use the screen, Ask me, More); each row opens in place.
 */
export function ComputerSheet({ target, refresh }: { target: SheetTarget<NodeInfo>; refresh: () => Promise<void> }) {
  if (target.kind === "phones") return <PhonesSheet />;
  if (target.kind === "loading" || target.kind === "gone")
    return (
      <>
        <SheetHead title="Computers" />
        <p className="px-4 pt-1 text-[14px] text-muted">{target.kind === "loading" ? "Loading…" : "That computer is gone."}</p>
      </>
    );
  return target.kind === "device" ? <Sheet node={target.node} computer={target.screen} refresh={refresh} /> : <Sheet computer={target.computer} host={target.host} refresh={refresh} />;
}

/** One sheet for a device (with its own screen, when agents have it) and for a VM or cloud computer. */
function Sheet({ node: n, computer: c, host, refresh }: { node?: NodeInfo; computer?: ComputerInfo; host?: NodeInfo; refresh: () => Promise<void> }) {
  const me = useStore((s) => s.me)!;
  const agents = useStore((s) => s.agents);
  const [sub, setSub] = useState<Sub | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = n?.name ?? c!.name;
  const kind = n ? "device" : c!.kind === "orgo" ? "cloud" : c!.kind;
  const status = useTileStatus({ kind, device: n, computer: c });
  const isOwner = me.role === "owner";
  const canEdit = me.role !== "guest";
  // an agent's own VM or cloud computer is always its to use: nothing to switch
  const sw = n ? screenSwitch(n, c, agents) : { on: true, there: false, users: [] };
  const ask = n ? askLevel(agents, n.id) : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // why Watch can't show the screen right now: a device's screen turned off there, or a VM that's off
  const block = c ? watchBlock(c, n) : n?.mine && n.online && !n.paused && n.capabilities?.screen.off ? { text: screenOffText(n.name), start: false, starting: false } : null;
  // a device's screen becomes a computer the first time someone watches it
  const screenReady = (c ? c.online && !c.paused : !!n?.mine && n.online && !n.paused && !!n.capabilities?.screen.ok) && !(block && !block.start && !block.starting);
  const open = async (take: boolean) => {
    const comp = c ?? (await api<ComputerInfo>("POST", "/api/computers", { kind: "device", nodeId: n!.id }));
    if (!c) await useStore.getState().refreshComputers();
    if (take && comp.controller?.id !== me.user.id) await api("POST", `/api/computers/${comp.id}/control`, { take: true });
    location.hash = watchHref(comp.id);
  };

  /**
   * The one switch the hub has for a device: may agents use it. On makes lending its screen the
   * device's job (its role). Off is the same things undone, each a call that exists today: the
   * role goes back to headless, agents allowed to use it lose that, and agents working on its
   * screen lose the screen ("stop sharing this screen").
   */
  const setScreen = (on: boolean) =>
    run(async () => {
      if (!n) return;
      if (on) await api("PATCH", `/api/nodes/${n.id}`, { role: "screen" satisfies DeviceRole });
      else {
        if (sw.users.length && !confirm(`Turn this off? ${sw.users.map((a) => a.name).join(", ")} won't be able to use ${n.name}.`)) return;
        if (n.role === "screen") await api("PATCH", `/api/nodes/${n.id}`, { role: "headless" satisfies DeviceRole });
        for (const a of sw.users) {
          if (!a.settings.useDevices?.[n.id]) continue;
          const { [n.id]: _gone, ...rest } = a.settings.useDevices;
          await api("PATCH", `/api/agents/${a.id}`, { settings: { useDevices: rest } });
        }
        const shared = !!c && sw.users.some((a) => a.computerId === c.id);
        if (shared) await api("DELETE", `/api/computers/${c!.id}`);
        // its own screen had an address of its own: stay on the device
        if (shared) go({ view: "computers", computerId: null, deviceId: n.id });
      }
      await Promise.all([refresh(), useStore.getState().refreshComputers(), useStore.getState().refreshAgents()]);
    });

  const retry = () =>
    run(async () => {
      await api("POST", `/api/nodes/${n!.id}/refresh`).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
    });

  const nested = sub && sub !== "ask" && sub !== "more";
  const offline = !!n && !n.online;
  return (
    <>
      <SheetHead title={sub ? SUB_TITLE[sub] : name} back={sub ? { label: nested ? "Back to More" : `Back to ${name}`, onClick: () => setSub(nested ? "more" : null) } : undefined} />
      <div key={sub ?? "main"} className={cx("min-h-0 flex-1 overflow-y-auto px-3.5 pb-[max(1.5rem,env(safe-area-inset-bottom))]", sub && "m-panel")}>
        {!sub && (
          <div className="space-y-3">
            <TilePicture tile={{ kind, computer: c }} status={status} className="aspect-[16/10] w-full" ghost={26} />
            <div className="flex items-center gap-2 px-0.5 text-[13px] leading-5">
              <p role="status" className={cx("min-w-0 flex-1 truncate", status.working ? "m-wait text-ink" : toneText(status.tone))}>
                {offline ? `Offline. ${connectionLine(n, timeAgo)}` : status.text}
              </p>
              {offline && (n.mine || isOwner) && (
                <button type="button" onClick={() => void retry()} disabled={busy} className="shrink-0 font-medium text-ink hover:underline disabled:opacity-50">
                  Retry
                </button>
              )}
            </div>
            {n?.update?.message && n.update.state !== "idle" && <p className={cx("px-0.5 text-[13px] whitespace-pre-wrap", n.update.state === "failed" ? "text-bad" : "text-muted")}>{n.update.message}</p>}
            {c && c.kind !== "device" ? <StartProblem computer={c} className="px-0.5" /> : c?.status === "error" && c.statusText && <p className="px-0.5 text-[13px] text-bad">{c.statusText}</p>}
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" disabled={busy || !screenReady} onClick={() => void run(() => open(false))}>
                Watch
              </Button>
              <Button className="flex-1" disabled={busy || !canEdit || !screenReady || (!!c?.controller && c.controller.id !== me.user.id)} onClick={() => void run(() => open(true))}>
                Take over
              </Button>
            </div>
            <div className={cx(CARD, "m-details-cards")}>
              {/* the hub has one switch for both today: the first sets it, the second shows it */}
              <SwitchRow label="Run commands and files" on={sw.on} disabled={busy || sw.there || !n?.mine} onChange={n ? (on) => void setScreen(on) : undefined} />
              <SwitchRow label="See and use the screen" on={sw.on} value={sw.on ? "On" : "Off"} />
              {n && <Row label="Ask me" value={ask?.level ? ASK_LEVELS.find((l) => l.id === ask.level)!.label : "Not used yet"} onClick={() => setSub("ask")} />}
              <Row label="More" onClick={() => setSub("more")} />
            </div>
            {block && !block.starting && (
              <p className="px-1 text-[13px] text-muted" data-testid="watch-block">
                {block.text}{" "}
                {block.start && canEdit && (
                  <button type="button" disabled={busy} onClick={() => void run(() => startComputer(c!.id))} className="font-medium text-ink underline underline-offset-2 disabled:opacity-50">
                    Start
                  </button>
                )}
              </p>
            )}
            {sw.there && <p className="px-1 text-[13px] text-muted">Set on this computer.</p>}
            {error && (
              <p role="alert" className="px-1 text-[13px] text-bad">
                {error}
              </p>
            )}
          </div>
        )}
        {sub === "ask" && n && <AskSheet node={n} />}
        {sub === "more" && (n ? <DeviceMore node={n} screen={c} open={setSub} refresh={refresh} /> : <ComputerMore computer={c!} host={host} open={setSub} />)}
        {sub === "tools" && n && <Harnesses node={n} />}
        {sub === "agents" && n && <AgentsHere node={n} />}
        {sub === "activity" && c && <ActivityLog computer={c} />}
        {sub === "remote" && n && <RemoteDesktop node={n} onChange={() => void refresh()} />}
      </div>
    </>
  );
}

/** The paired phones: the hub knows how many get notifications, not which. Pair another, or see their sign-ins. */
function PhonesSheet() {
  const phones = usePhones();
  const add = useAddFlow();
  return (
    <>
      <SheetHead title={phones > 1 ? `${phones} phones` : "Phone"} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <span className="grid aspect-[16/10] w-full place-items-center rounded-[10px] bg-card text-muted">
          <Smartphone size={34} strokeWidth={1.5} />
        </span>
        <p role="status" className="px-0.5 text-[13px] leading-5 text-muted">
          Paired
        </p>
        <div className={cx(CARD, "m-details-cards")}>
          <Row label="Pair a phone" onClick={() => add.start("phone")} />
          <Row label="Phone sign-ins" href={href({ view: "settings", page: "security" })} />
        </div>
      </div>
      {add.element}
    </>
  );
}

/** Every time, once per task, or tell me after: how the agents allowed on this device ask before using it. */
function AskSheet({ node: n }: { node: NodeInfo }) {
  const agents = useStore((s) => s.agents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { level, agents: allowed } = askLevel(agents, n.id);
  const pick = async (next: "ask" | "tell") => {
    if (next === level) return;
    setBusy(true);
    setError(null);
    try {
      for (const a of allowed) if (a.settings.useDevices?.[n.id] !== next) await api("PATCH", `/api/agents/${a.id}`, { settings: { useDevices: { ...a.settings.useDevices, [n.id]: next } } });
      await useStore.getState().refreshAgents();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Ask me" className={CARD}>
        {ASK_LEVELS.map((l) => (
          // "Every time" has nothing behind it on the hub yet: shown, not pickable
          <button key={l.id} type="button" role="radio" aria-checked={level === l.id} disabled={busy || l.id === "always" || !n.mine || !allowed.length} onClick={() => l.id !== "always" && void pick(l.id)} className={cx(ROW, "hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent")}>
            <span className="min-w-0 flex-1 truncate font-medium">{l.label}</span>
            {level === l.id && <Check size={15} className="shrink-0" aria-hidden />}
          </button>
        ))}
      </div>
      <p className="px-1 text-[13px] text-muted">{allowed.length ? allowed.map((a) => a.name).join(", ") : "No agents use it yet."}</p>
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
    </div>
  );
}

const ROLE_LABEL: Record<DeviceRole, string> = { vms: "Runs VMs", screen: "Uses its screen", headless: "Headless" };

/** The hub's own version, to tell whether a device has a newer Bubble AI to get. Undefined while asking. */
function useHubVersion(): HubVersion | null | undefined {
  const [v, setV] = useState<HubVersion | null | undefined>(undefined);
  useEffect(() => {
    api<HubVersion>("GET", "/api/updates").then(setV, () => setV(null));
  }, []);
  return v;
}

/** The rest of a device: its kind, sharing, AI tools, agents, activity, updates, remote desktop, what is set only there, and Forget. */
function DeviceMore({ node: n, screen, open, refresh }: { node: NodeInfo; screen?: ComputerInfo; open: (s: Sub) => void; refresh: () => Promise<void> }) {
  const isOwner = useStore((s) => s.me)?.role === "owner";
  const agents = useStore((s) => s.agents).filter((a) => a.nodeId === n.id);
  const remoteDesktop = useFeature("remoteDesktop");
  const hub = useHubVersion();
  const [error, setError] = useState<string | null>(null);
  const canManage = n.mine || isOwner;
  const busyUpdate = n.update?.state === "updating" || n.update?.state === "restarting";
  // it can't be picked when the device can't do it; a device that has it keeps saying so
  const vmNo = n.role !== "vms" && n.capabilities?.vm && !n.capabilities.vm.ok ? n.capabilities.vm.detail || "This device can't run VMs yet." : null;
  const installed = (n.harnesses ?? []).map((h) => harnessLabel(h.id));
  const code = n.capabilities?.screen.code;
  const way = n.capabilities?.rustdesk ? "RustDesk" : n.remoteDesktop ? (n.remoteDesktop.app === "other" && n.remoteDesktop.name ? n.remoteDesktop.name : REMOTE_APPS[n.remoteDesktop.app].label) : "Not set";

  const patch = async (body: object) => {
    setError(null);
    await api("PATCH", `/api/nodes/${n.id}`, body).catch((e) => setError((e as Error).message));
    await refresh();
  };
  const update = async () => {
    setError(null);
    await api("POST", `/api/nodes/${n.id}/update`).catch((e) => setError((e as Error).message));
    await refresh();
  };
  const forget = async () => {
    if (!confirm(`Forget ${n.name}? Its token stops working.`)) return;
    try {
      await api("DELETE", `/api/nodes/${n.id}`);
      go({ view: "computers", computerId: null });
    } catch (e) {
      setError(`Couldn't forget ${n.name}: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className={CARD}>
        <label className={ROW}>
          <span className="shrink-0 font-medium">Kind</span>
          <select aria-label="Kind" value={n.role ?? ""} disabled={!n.mine} onChange={(e) => void patch({ role: e.target.value })} className="ml-auto min-w-0 max-w-[62%] cursor-pointer bg-transparent text-right text-[13px] text-muted outline-none disabled:cursor-default">
            {!n.role && (
              <option value="" disabled>
                Not set
              </option>
            )}
            {(Object.keys(ROLE_LABEL) as DeviceRole[]).map((r) => (
              <option key={r} value={r} disabled={r === "vms" && !!vmNo}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {n.mine ? <SwitchRow label="Shared with the workspace" on={n.shared} onChange={(shared) => void patch({ shared })} /> : <Fact label="Shared with" value={n.shared ? "The workspace" : `Just ${n.ownerName ?? "its owner"}`} />}
        <Row label="AI tools" value={installed.join(", ") || "None yet"} onClick={() => open("tools")} />
        <Row label="Agents" value={agents.map((a) => a.name).join(", ") || "None yet"} onClick={() => open("agents")} />
        {screen && <Row label="Activity" onClick={() => open("activity")} />}
        {n.mine && remoteDesktop && <Row label="Remote desktop" value={way} onClick={() => open("remote")} />}
        {isOwner && n.online && hub !== undefined && (busyUpdate || updateExists(n, hub)) && <Row act label={busyUpdate ? "Updating…" : "Update Bubble AI"} onClick={() => void update()} disabled={busyUpdate} />}
      </div>
      {vmNo && n.mine && <p className="px-1 text-[13px] text-muted">{vmNo}</p>}
      {n.mine && (
        <>
          <div className={CARD}>
            <Fact label="Screen code" value={code ? (code === "pin" ? "PIN" : "Password") : "None"} />
            <Fact label="Pause" value={n.paused ? "On" : "Off"} />
          </div>
          <p className="px-1 text-[13px] text-muted">Set on this computer.</p>
        </>
      )}
      {error && (
        <p role="alert" className="px-1 text-[13px] text-bad">
          {error}
        </p>
      )}
      {canManage && (
        <button type="button" onClick={() => void forget()} className="mx-auto block h-9 px-3 text-[13px] font-medium text-bad hover:underline">
          Forget this computer
        </button>
      )}
    </div>
  );
}

/** The rest of a VM or cloud computer: its kind, where it runs, size, who uses it, start or stop, activity, rename, and Forget. */
function ComputerMore({ computer: c, host, open }: { computer: ComputerInfo; host?: NodeInfo; open: (s: Sub) => void }) {
  const me = useStore((s) => s.me)!;
  const agents = useStore((s) => s.agents).filter((a) => c.agents.includes(a.id));
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canEdit = me.role !== "guest";
  const canRemove = c.kind === "device" ? c.ownerId === me.user.id : c.kind === "vm" ? me.role === "owner" || !!host?.mine : true;
  // off, or it couldn't start: Start (Try again); otherwise Stop
  const startable = c.status === "stopped" || c.status === "error";
  const size = sizeLine(c);
  const forget = async () => {
    const what = c.kind === "vm" ? "Its VM and everything on it are deleted." : c.kind === "orgo" ? "The Orgo computer is deleted too." : "Agents won't be able to use this device's screen.";
    if (!confirm(`Forget ${c.name}? ${what}`)) return;
    try {
      await api("DELETE", `/api/computers/${c.id}`);
      go({ view: "computers", computerId: null });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <div className={CARD}>
        <Fact label="Kind" value={c.kind === "orgo" ? "Cloud computer" : c.kind === "device" ? "Own screen" : isSharedComputer(c) ? "Shared desktop" : "Own desktop"} />
        {host && <Row label="Runs on" value={host.name} href={href({ view: "computers", computerId: null, deviceId: host.id })} />}
        {size && <Fact label="Size" value={size} />}
        {agents.length > 0 && <Fact label="Used by" value={agents.map((a) => a.name).join(", ")} />}
        {c.kind !== "device" && canEdit && <Row act label={c.status === "error" ? "Try again" : startable ? "Start" : "Stop"} onClick={() => void api("POST", `/api/computers/${c.id}/${startable ? "start" : "stop"}`).catch((e) => setError((e as Error).message))} />}
        <Row label="Activity" onClick={() => open("activity")} />
        {canEdit && <Row label="Rename" onClick={() => setRenaming(true)} />}
      </div>
      {error && (
        <p role="alert" className="px-1 text-[13px] text-bad">
          {error}
        </p>
      )}
      {canRemove && (
        <button type="button" onClick={() => void forget()} className="mx-auto block h-9 px-3 text-[13px] font-medium text-bad hover:underline">
          Forget this computer
        </button>
      )}
      {renaming && <RenameComputer computer={c} onClose={() => setRenaming(false)} />}
    </div>
  );
}

function RenameComputer({ computer, onClose }: { computer: ComputerInfo; onClose: () => void }) {
  const [name, setName] = useState(computer.name);
  return (
    <Modal title="Rename" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await api("PATCH", `/api/computers/${computer.id}`, { name });
          onClose();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <div className="flex justify-end">
          <Button variant="primary">Save</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Who did what on this computer, newest first. */
function ActivityLog({ computer: c }: { computer: ComputerInfo }) {
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const [log, setLog] = useState<{ actor: Actor; text: string; at: string }[] | null>(null);
  const activityAt = c.activity?.at;
  useEffect(() => {
    api<{ actor: Actor; text: string; at: string }[]>("GET", `/api/computers/${c.id}/log`).then(setLog, () => setLog([]));
  }, [c.id, activityAt, c.controller?.id]);
  const who = (a: Actor) => (a.kind === "agent" ? (agents.find((x) => x.id === a.id)?.name ?? "An agent") : (members.find((m) => m.id === a.id)?.name ?? "Someone"));
  if (!log) return null;
  if (!log.length) return <p className="px-1 text-[13px] text-muted">Nothing yet.</p>;
  return (
    <ol className="space-y-2 px-1 text-[13px] leading-5" aria-label="Activity">
      {log.slice(0, 50).map((l, i) => (
        <li key={i} className="flex items-baseline gap-2">
          <span className="size-[7px] shrink-0 self-center rounded-full" style={{ background: activityDot(l.text) }} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {l.actor.id === "system" ? (
              // things that happened on their own (wrong codes) read as a sentence
              <span className="text-muted">{l.text}</span>
            ) : (
              <>
                <span className="font-medium">{who(l.actor)}</span> <span className="text-muted">{l.text.charAt(0).toLowerCase() + l.text.slice(1)}</span>
              </>
            )}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-faint">{timeAgo(l.at)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The AI tools this device can run, with Install for the ones Bubble AI can install, and how to sign each in. */
function Harnesses({ node: n }: { node: NodeInfo }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [howTo, setHowTo] = useState<HarnessInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const installed = new Map((n.harnesses ?? []).map((h) => [h.id, h.version]));
  const list = HARNESSES.filter((h) => h.protocol !== "mcp");
  const install = async (h: HarnessInfo) => {
    setBusy(h.id);
    setError(null);
    setNote(null);
    try {
      await api("POST", `/api/nodes/${n.id}/install`, { harness: h.id });
      setNote(`${h.label} is installed. Sign it in on ${n.name}: ${h.login ?? h.binary}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const refresh = async () => {
    setChecking(true);
    await api("POST", `/api/nodes/${n.id}/refresh`).catch((e) => setError((e as Error).message));
    await new Promise((r) => setTimeout(r, 2500));
    setChecking(false);
  };
  return (
    <div className="space-y-3">
      {error && <p className="px-1 text-[13px] text-bad whitespace-pre-wrap">{error}</p>}
      {note && <p className="rounded-[10px] bg-ok/10 px-3 py-2 text-[13px] text-ok">{note}</p>}
      <div className={CARD}>
        {list.map((h) => {
          const here = n.harnesses?.find((x) => x.id === h.id);
          const act = "shrink-0 text-[13px] font-medium text-ink hover:underline disabled:opacity-50 disabled:hover:no-underline";
          return (
            <div key={h.id} className={cx(ROW, "gap-2.5")}>
              <HarnessLogo harness={h.id} size={18} />
              <span className="min-w-0 flex-1 truncate font-medium">{h.label}</span>
              {!here ? (
                h.install?.npm && n.mine ? (
                  <button type="button" className={act} disabled={busy === h.id || !n.online} onClick={() => void install(h)}>
                    {busy === h.id ? "Installing…" : "Install"}
                  </button>
                ) : (
                  <button type="button" className={act} onClick={() => setHowTo(h)}>
                    How to install
                  </button>
                )
              ) : here.accounts?.default === false ? (
                // installed, nobody signed in: the same sheet says how
                <button type="button" className={act} onClick={() => setHowTo(h)}>
                  Sign in
                </button>
              ) : (
                <span className="shrink-0 text-[13px] text-muted">{installed.get(h.id) ? `Version ${installed.get(h.id)}` : "Installed"}</span>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => void refresh()} disabled={checking || !n.online} className="inline-flex items-center gap-1.5 px-1 text-[13px] font-medium text-muted hover:text-ink disabled:opacity-50">
        <RefreshCw size={13} className={cx(checking && "animate-spin")} /> Look again
      </button>
      {howTo && <HowToInstall h={howTo} device={n} onClose={() => setHowTo(null)} />}
    </div>
  );
}

/** The new-agent dialog, starting on this device. */
function CreateAgentHere({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const devices = useDevices();
  return devices ? <CreateAgent nodes={devices} nodeId={nodeId} onClose={onClose} /> : null;
}

/** What an agent can work on from this device: its screen, a VM here, or nothing. */
type WorksOn = { kind: "screen" } | { kind: "computer"; id: string } | { kind: "new-vm" } | { kind: "none" };

/** The agents whose harness runs on this device, and what each one works on. */
function AgentsHere({ node: n }: { node: NodeInfo }) {
  const agents = useStore((s) => s.agents).filter((a) => a.nodeId === n.id);
  const computers = useStore((s) => s.computers);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const screen = computers.find((c) => c.kind === "device" && c.nodeId === n.id);
  const vms = computers.filter((c) => c.kind === "vm" && c.nodeId === n.id);
  const canAdd = n.mine || n.shared;

  const set = async (a: Agent, choice: WorksOn) => {
    if (choice.kind === "none" && !confirm(`Run ${a.name} without a computer? It won't be able to use apps or websites.`)) return;
    setBusy(a.id);
    setError(null);
    try {
      if (choice.kind === "none") await api("PATCH", `/api/agents/${a.id}`, { computerId: null, settings: { headless: true } });
      else if (choice.kind === "screen") {
        const c = screen ?? (await api<ComputerInfo>("POST", "/api/computers", { kind: "device", nodeId: n.id }));
        await api("PATCH", `/api/agents/${a.id}`, { computerId: c.id });
      } else if (choice.kind === "new-vm") {
        const c = await api<ComputerInfo>("POST", "/api/computers", { kind: "vm", nodeId: n.id, name: `${a.name}'s desk`, cpus: 2, memoryGb: 4 });
        // a harness that comes with the VM moves in with it, unless someone already chose where it runs
        await api("PATCH", `/api/agents/${a.id}`, { computerId: c.id, ...(runsInVm(a.harness) && !a.settings.runIn ? { settings: { runIn: "computer" } } : {}) });
      } else await api("PATCH", `/api/agents/${a.id}`, { computerId: choice.id });
      await Promise.all([useStore.getState().refreshAgents(), useStore.getState().refreshComputers()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {agents.length > 0 && (
        <ul className={CARD}>
          {agents.map((a) => (
            <li key={a.id} className={cx(ROW, "gap-2.5")}>
              <AgentAvatar agent={a} size={24} live={n.online} />
              <a href={href({ view: "agents", agentId: a.id, tab: null })} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {a.name}
              </a>
              {n.mine ? <WorksOnPicker agent={a} node={n} screen={screen} vms={vms} busy={busy === a.id} onPick={(c) => set(a, c)} /> : <span className="shrink-0 text-[13px] text-muted">{worksOnLabel(a, computers)}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
      {canAdd && (
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> Add an agent
        </Button>
      )}
      {creating && <CreateAgentHere nodeId={n.id} onClose={() => setCreating(false)} />}
    </div>
  );
}

function worksOnLabel(a: Agent, computers: ComputerInfo[]): string {
  const c = computers.find((x) => x.id === a.computerId);
  if (c?.kind === "device") return "This screen";
  if (c) return c.name;
  return a.computerId ? "Its owner's screen" : "No screen";
}

/** "This screen", a VM here, a new VM, or no computer; the agent's current one shows first. */
function WorksOnPicker({ agent: a, node: n, screen, vms, busy, onPick }: { agent: Agent; node: NodeInfo; screen: ComputerInfo | undefined; vms: ComputerInfo[]; busy: boolean; onPick: (c: WorksOn) => void }) {
  const computers = useStore((s) => s.computers);
  const current = computers.find((c) => c.id === a.computerId);
  const caps = n.capabilities;
  const value = current?.kind === "device" ? "screen" : current ? current.id : "none";
  // a computer it already has somewhere else (a cloud computer) stays pickable
  const elsewhere = current && current.kind !== "device" && current.nodeId !== n.id ? current : undefined;
  return (
    <select
      aria-label={`What ${a.name} works on`}
      disabled={busy}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        onPick(v === "screen" ? { kind: "screen" } : v === "new-vm" ? { kind: "new-vm" } : v === "none" ? { kind: "none" } : { kind: "computer", id: v });
      }}
      className="h-8 max-w-[7.5rem] shrink-0 rounded-lg border border-line bg-panel px-2 text-xs text-ink"
    >
      <option value="screen" disabled={!caps?.screen.ok && value !== "screen"}>
        {caps?.screen.ok || value === "screen" ? "This screen" : caps?.screen.off ? "This screen (off)" : "This screen (not available)"}
      </option>
      {vms.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      {elsewhere && <option value={elsewhere.id}>{elsewhere.name}</option>}
      {caps?.vm.ok && <option value="new-vm">New VM</option>}
      <option value="none">No screen</option>
    </select>
  );
}

/** What to put in each kind of field, and an example. */
const FIELD_HINT = {
  id: { label: "Its ID", placeholder: "123 456 789" },
  address: { label: "Computer name or address", placeholder: "shop-pc.local or 192.168.1.20" },
  link: { label: "Link", placeholder: "https://…" },
} as const;

/**
 * The Remote desktop mod: how its owner reaches this device from anywhere. RustDesk (set up at the
 * device), or the app they already use, by its ID, address or link. Never a password. Its owner's alone.
 */
function RemoteDesktop({ node: n, onChange }: { node: NodeInfo; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showRustdesk, setShowRustdesk] = useState(false);
  const rustdesk = n.capabilities?.rustdesk;
  const own = n.remoteDesktop;
  const save = async (remoteDesktop: OwnRemoteDesktop | null) => {
    await api("PATCH", `/api/nodes/${n.id}`, { remoteDesktop });
    setEditing(false);
    onChange();
  };
  const remove = () => {
    if (confirm(`Stop showing ${own ? REMOTE_APPS[own.app].label : "this app"} here? The app itself isn't changed.`)) void save(null).catch((e) => alert((e as Error).message));
  };
  return (
    <section className="rounded-[14px] bg-card p-3.5">
      {rustdesk && <RemoteRow label="RustDesk" value={formatRustdeskId(rustdesk.id)} copy={rustdesk.id} link={`rustdesk://${encodeURIComponent(rustdesk.id)}`} />}
      {own && !editing && <RemoteRow label={own.app === "other" && own.name ? own.name : REMOTE_APPS[own.app].label} value={REMOTE_APPS[own.app].field === "id" ? formatRustdeskId(own.value) : own.value} copy={own.value} link={remoteDesktopLink(own)} onChange={() => setEditing(true)} onRemove={remove} />}
      {editing ? (
        <OwnAppForm node={n} current={own ?? null} onSave={save} onCancel={() => setEditing(false)} />
      ) : !rustdesk && !own ? (
        showRustdesk ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted">Run this on {n.name}.</p>
            <CopyBlock text="bubble-ai node rustdesk" />
            <button className="text-xs text-muted hover:text-ink" onClick={() => setShowRustdesk(false)}>
              Back
            </button>
          </div>
        ) : (
          <div className="grid gap-2">
            <button onClick={() => setShowRustdesk(true)} className="rounded-xl border border-line2 p-3 text-left hover:bg-hover">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Download size={15} /> Set up RustDesk
              </div>
            </button>
            <button onClick={() => setEditing(true)} className="rounded-xl border border-line p-3 text-left hover:bg-hover">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Link2 size={15} /> I already use one
              </div>
              {!!n.capabilities?.remoteApps?.length && <p className="mt-0.5 text-xs text-muted">{`${n.capabilities.remoteApps.map((a) => REMOTE_APPS[a as RemoteApp]?.label ?? a).join(", ")} ${n.capabilities.remoteApps.length === 1 ? "is" : "are"} on ${n.name}.`}</p>}
            </button>
          </div>
        )
      ) : (
        !own && (
          <button className="mt-2 text-xs text-muted hover:text-ink" onClick={() => setEditing(true)}>
            Add another app you use
          </button>
        )
      )}
    </section>
  );
}

/** One way in: the app, the device's ID or address in it, Copy, and Open where the app has a link. */
function RemoteRow({ label, value, copy, link, onChange, onRemove }: { label: string; value: string; copy: string; link: string | null; onChange?: () => void; onRemove?: () => void }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    await navigator.clipboard.writeText(copy).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="mt-2 pt-2 first-of-type:mt-0 first-of-type:pt-0 border-t first-of-type:border-t-0 border-line">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-36">
          <div className="text-xs text-muted">{label}</div>
          <div className="font-mono text-base tabular-nums break-all">{value}</div>
        </div>
        <Button onClick={doCopy}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
        </Button>
        {link && (
          <a href={link} target={link.startsWith("https:") ? "_blank" : undefined} rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full bg-accent text-accent-ink text-sm font-medium whitespace-nowrap hover:bg-accent/90">
            <ExternalLink size={15} /> Open
          </a>
        )}
        {(onChange || onRemove) && (
          <Menu
            align="right"
            items={[...(onChange ? [{ label: "Change", onSelect: onChange }] : []), ...(onRemove ? [{ label: "Remove", danger: true, onSelect: onRemove }] : [])]}
            trigger={(open, toggle) => (
              <button className={cx("p-1.5 rounded-md text-muted hover:bg-hover hover:text-ink", open && "bg-hover text-ink")} aria-label={`More for ${label}`} onClick={toggle}>
                <MoreHorizontal size={16} />
              </button>
            )}
          />
        )}
      </div>
    </div>
  );
}

/** Which app, and the device's ID, address or link in it. Apps found on the device come first. */
function OwnAppForm({ node: n, current, onSave, onCancel }: { node: NodeInfo; current: OwnRemoteDesktop | null; onSave: (r: OwnRemoteDesktop) => Promise<void>; onCancel: () => void }) {
  const found = (n.capabilities?.remoteApps ?? []).filter((a): a is RemoteApp => a in REMOTE_APPS);
  const order = [...found, ...REMOTE_APP_IDS.filter((a) => !found.includes(a))];
  const [app, setApp] = useState<RemoteApp>(current?.app ?? order[0]);
  const [value, setValue] = useState(current?.value ?? "");
  const [name, setName] = useState(current?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = FIELD_HINT[REMOTE_APPS[app].field];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // IDs are often copied with spaces ("123 456 789")
    const v = REMOTE_APPS[app].field === "id" ? value.replace(/\s+/g, "") : value.trim();
    const r = { app, value: v, ...(app === "other" && name.trim() ? { name: name.trim() } : {}) };
    const check = OwnRemoteDesktop.safeParse(r);
    if (!check.success) return setError(check.error.issues[0]?.message ?? "Check what you entered.");
    setBusy(true);
    setError(null);
    try {
      await onSave(check.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="App">
        <select value={app} onChange={(e) => setApp(e.target.value as RemoteApp)} className="h-9 w-full rounded-xl border border-input bg-panel px-3 text-sm text-ink">
          {order.map((a) => (
            <option key={a} value={a}>
              {REMOTE_APPS[a].label}
              {found.includes(a) ? ` (on ${n.name})` : ""}
            </option>
          ))}
        </select>
      </Field>
      {app === "other" && (
        <Field label="Its name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Parsec" maxLength={60} />
        </Field>
      )}
      <Field label={field.label}>
        <Input value={value} onChange={(e) => (setValue(e.target.value), setError(null))} placeholder={app === "chrome" ? "https://remotedesktop.google.com/access" : field.placeholder} autoFocus />
      </Field>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy || !value.trim()}>
          Save
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
