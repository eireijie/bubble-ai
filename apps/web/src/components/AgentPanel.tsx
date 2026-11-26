import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { isTopOverlay, toBody, topOverlay, useOverlay } from "../overlays.ts";
import { Check, ChevronLeft, ChevronRight, Eye, Hand, Loader2, Maximize2, MessageSquare, Minimize2, Shield, ShieldAlert, Video, X } from "lucide-react";
import { harnessLabel, type AccessLevel, type Agent } from "@bubble-ai/core";
import { defaultAppearance } from "@bubble-ai/core/src/appearance.ts";
import { api } from "../api.ts";
import { useStore, useTeams, type ComputerInfo } from "../store.ts";
import { liveShape } from "../liveShape.ts";
import { useFeature } from "../features.ts";
import { go, href, type AgentTab } from "../router.ts";
import { openDm } from "../openDm.ts";
import { agentReadiness, agentSignedIn, useDevices, type DeviceInfo } from "../devices.ts";
import { patchAgent, prettyModel, runLine, useAgentContext } from "../models.ts";
import { useComputerState } from "../views/computerState.ts";
import { LiveScreen, WorkingBadge } from "./Screen.tsx";
import { Ghost } from "./Ghost.tsx";
import { AgentAvatar, Button, Pill, cx } from "./ui.tsx";
import { RunPanel } from "./RunPanel.tsx";
import { stopRuns, workDetail } from "./ActivityPill.tsx";
import { minutesSince, runStartedAt } from "./agentActivity.ts";
import { lazyView } from "../lazy.tsx";
import { setChannelPrefs } from "./Channels.tsx";
import { Toggle } from "../views/settings/parts.tsx";

// How calls sound sits in More, and lives with the call screen: a file of its own, fetched in the
// background after the app is up (lazy.tsx), so a chat doesn't bring the voice engine with it.
const CallOptions = lazyView(() => import("../voice/CallScreen.tsx").then((m) => m.CallOptions));

/** What the panel shows: the agent itself ("details"), or the sheet one of its rows opens. */
export type AgentPanelTab = "details" | "computer" | "thinks" | "can" | "asks" | "knows" | "more";

const SHEETS: Record<Exclude<AgentPanelTab, "details">, string> = { computer: "Computer", thinks: "Thinks with", can: "Can use", asks: "Asks first", knows: "Knows", more: "More" };
/** A sheet by name; anything else (an old remembered tab) is the agent itself. */
export const panelSheet = (tab: string | null | undefined): AgentPanelTab => (tab && tab in SHEETS ? (tab as AgentPanelTab) : "details");

const ACCESS_LABEL: Record<AccessLevel, string> = { "read-only": "Read only", edit: "Can edit files", full: "Full access" };

const CARD = "overflow-hidden rounded-[12px] bg-card divide-y divide-line";
const ROW = "flex h-[46px] w-full items-center gap-3 px-3.5 text-left text-[14px] hover:bg-hover disabled:hover:bg-transparent";

/**
 * An agent in the pane beside a chat (its own, or a team it works in): 310 px, pushing the chat.
 * Its live ghost, name and one editable line of what it does; what it is doing right now, with
 * Stop, while it works; then one card of rows (Thinks with, Works on, Can use, Asks first, Knows,
 * More), each showing its value and opening a sheet in place or the matching tab of its page.
 */
export function AgentPanel({ agent, channelId, tab, onClose, onSheet, inDm = false }: { agent: Agent; channelId: string; tab?: AgentPanelTab; onClose: () => void; onSheet?: (tab: AgentPanelTab) => void; inDm?: boolean }) {
  const [sheet, setSheetState] = useState<AgentPanelTab>(() => panelSheet(tab));
  // the chat remembers which sheet is open, so the next DM opens on it too (its computer, say)
  const setSheet = (t: AgentPanelTab) => (setSheetState(t), onSheet?.(t));
  // the chat can ask for a sheet while the panel is open (the header's "nearly full" ring)
  useEffect(() => setSheetState(panelSheet(tab)), [tab]);
  // Escape closes the panel, unless a dialog or a menu over it takes Escape first
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || topOverlay() !== null || document.querySelector('[role="menu"]')) return;
      closeRef.current();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  // who is working, not the words: streamed text must not re-render the panel (liveShape.ts)
  const live = useStore(liveShape);
  const agents = useStore((s) => s.agents);
  const canEdit = useStore((s) => s.me?.role !== "guest");
  const computer = useStore((s) => s.computers.find((c) => c.id === agent.computerId));
  const { ctx, models } = useAgentContext(agent.id, channelId);
  const devices = useDevices();
  const readiness = agentReadiness(agent, devices);
  const device = devices?.find((d) => d.id === agent.nodeId);
  const runs = Object.values(live).filter((r) => r.agentId === agent.id);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!runs.length) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [runs.length]);
  const run = runs.at(-1);
  const since = runs.length ? Math.min(...runs.map((r) => runStartedAt(r.runId))) : null;
  const access = ctx?.access ?? agent.settings.access ?? "edit";
  const back = () => setSheet("details");
  const page = (t: AgentTab) => href({ view: "agents", agentId: agent.id, tab: t });

  return (
    <aside
      onClickCapture={(e) => {
        // the agent's full page replaces the panel instead of opening on top of it
        if ((e.target as HTMLElement).closest?.('a[href^="#/agents/"]')) onClose();
      }}
      aria-label={`${agent.name}'s details`} className={cx("m-details fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-panel safe-top lg:relative lg:inset-auto lg:z-auto lg:shrink-0 lg:border-l lg:border-line", sheet === "computer" ? "lg:w-[460px]" : "lg:w-[310px]")}>
      {/* its own 310 px, so nothing reflows while the pane opens */}
      <div className={cx("flex min-h-0 flex-1 flex-col", sheet === "computer" ? "lg:w-[460px]" : "lg:w-[310px]")}>
        <div className="relative flex h-14 shrink-0 items-center justify-between px-3">
          {sheet === "details" ? (
            <span />
          ) : (
            <button type="button" onClick={back} className="circle circle-sm" aria-label={`Back to ${agent.name}`}>
              <ChevronLeft size={18} />
            </button>
          )}
          {sheet !== "details" && <h2 className="pointer-events-none absolute inset-x-12 truncate text-center text-[14px] font-semibold">{sheet === "computer" ? `${agent.name}'s computer` : SHEETS[sheet]}</h2>}
          <button type="button" onClick={onClose} className="circle circle-sm" aria-label="Close panel">
            <X size={16} />
          </button>
        </div>
        <div key={sheet} className={cx("min-h-0 flex-1 overflow-y-auto px-3.5 pb-6", sheet !== "details" && "m-panel")}>
          {sheet === "details" && (
            <>
              <div className="flex flex-col items-center gap-1 pb-4 text-center">
                <AgentAvatar agent={agent} size={64} live />
                <h2 className="mt-2 max-w-full truncate text-[19px] font-semibold leading-[26px]">{agent.name}</h2>
                <div className="max-w-full [&_input]:text-center">
                  <RoleLabel agent={agent} />
                </div>
                {(run || agent.status === "busy") && (
                  <div className="flex max-w-full items-center gap-2 text-[13px] leading-5 text-muted" role="status">
                    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-st-working" aria-hidden />
                    <span className="min-w-0 truncate">
                      {run ? workDetail(run, agents) : "Working"}
                      {since ? ` · ${minutesSince(since)}` : ""}
                    </span>
                    {runs.length > 0 && canEdit && (
                      <button type="button" onClick={() => void stopRuns(runs)} className="shrink-0 font-medium text-ink hover:underline">
                        Stop
                      </button>
                    )}
                  </div>
                )}
                {!inDm && (
                  <Button className="mt-2 h-8!" onClick={() => void openDm(agent.id)}>
                    <MessageSquare size={14} /> Message
                  </Button>
                )}
              </div>
              <div className={cx(CARD, "m-details-cards")}>
                <PanelRow label="Thinks with" value={ctx ? runLine(ctx, models) : [harnessLabel(agent.harness), agent.model ? prettyModel(agent.model) : null].filter(Boolean).join(" · ")} onClick={() => setSheet("thinks")} />
                <PanelRow
                  label="Works on"
                  value={!readiness.ready ? (readiness.problem ?? "Setup incomplete") : (computer?.name ?? device?.name ?? "None yet")}
                  warn={!readiness.ready}
                  href={page("device")}
                />
                <PanelRow label="Can use" onClick={() => setSheet("can")} />
                <PanelRow label="Asks first" value={ACCESS_LABEL[access]} onClick={() => setSheet("asks")} />
                <PanelRow label="Knows" onClick={() => setSheet("knows")} />
                <PanelRow label="More" onClick={() => setSheet("more")} />
              </div>
              <p className="m-details-cards px-1 pt-3 text-[13px] leading-5 text-muted">Or ask {agent.name} to change any of it.</p>
            </>
          )}
          {sheet === "computer" && (
            <div className="space-y-3">
              {computer ? <ComputerCard agent={agent} computer={computer} /> : <p className="px-1 py-6 text-center text-[14px] text-muted">{agent.name} has no computer yet.</p>}
              <div className={CARD}>
                <PanelRow label="Computer" value={computer ? computer.name : "None yet"} href={computer ? href({ view: "computers", computerId: computer.id }) : page("computer")} />
              </div>
            </div>
          )}
          {sheet === "thinks" && ctx && <RunPanel big agent={agent} ctx={ctx} models={models} channelId={channelId} canEdit={canEdit} close={back} />}
          {sheet === "can" && (
            <div className={CARD}>
              <PanelRow label="Apps" href={page("apps")} />
              <PanelRow label="Skills" href={page("skills")} />
              <PanelRow label="Add" href={href({ view: "marketplace", forAgent: agent.id })} />
            </div>
          )}
          {sheet === "asks" && (
            <div className="space-y-3">
              <AccessList agent={agent} access={access} canEdit={canEdit} />
              <div className={CARD}>
                <PanelRow label="Permissions" href={page("permissions")} />
              </div>
            </div>
          )}
          {sheet === "knows" && (
            <div className="space-y-3">
              {agent.settings.roleNotes && <p className="whitespace-pre-wrap px-1 text-[13px] leading-5 text-muted">{agent.settings.roleNotes}</p>}
              <div className={CARD}>
                <PanelRow label="Memory" href={page("memory")} />
                <PanelRow label="Personality" href={page("soul")} />
                <PanelRow label="Instructions" href={page("instructions")} />
              </div>
            </div>
          )}
          {sheet === "more" && <MoreSheet agent={agent} page={page} />}
        </div>
      </div>
    </aside>
  );
}

/** One row of the panel: its label, the current value, a chevron. A button (opens a sheet here) or a link (a tab of the agent's page). */
function PanelRow({ label, value, warn, onClick, href: to }: { label: string; value?: ReactNode; warn?: boolean; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="shrink-0 font-medium">{label}</span>
      <span className={cx("min-w-0 flex-1 truncate text-right text-[13px]", warn ? "text-st-needs" : "text-muted")}>{value}</span>
      <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />
    </>
  );
  return to ? (
    <a href={to} className={ROW}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={ROW}>
      {inner}
    </button>
  );
}

/** A plain fact in a card (its handle, the teams it is on): no chevron, nothing to open. */
function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-[46px] items-center gap-3 px-3.5 text-[14px]">
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[13px] text-muted">{value}</span>
    </div>
  );
}

/** What it does, in one line, edited in place. */
function RoleLabel({ agent }: { agent: Agent }) {
  const canEdit = useStore((s) => s.me?.role !== "guest");
  const [value, setValue] = useState(agent.settings.role ?? "");
  useEffect(() => setValue(agent.settings.role ?? ""), [agent.id, agent.settings.role]);
  const save = async () => {
    const role = value.trim();
    if (role === (agent.settings.role ?? "")) return;
    await api("PATCH", `/api/agents/${agent.id}`, { settings: { role } }).catch(() => setValue(agent.settings.role ?? ""));
    await useStore.getState().refreshAgents();
  };
  if (!canEdit) return agent.settings.role ? <div className="text-sm text-muted">{agent.settings.role}</div> : null;
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      placeholder="What it does"
      aria-label="What it does"
      maxLength={60}
      className="w-56 max-w-full bg-transparent text-sm text-muted placeholder:text-faint outline-none focus:text-ink rounded-md hover:bg-hover focus:bg-hover px-1.5 h-6"
    />
  );
}

/** What it may do on its computer without asking: read only, edit files, or everything. */
function AccessList({ agent, access, canEdit }: { agent: Agent; access: AccessLevel; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const pick = (k: AccessLevel) => {
    setError(null);
    if (k !== access) patchAgent(agent.id, { settings: { access: k } }).catch((e) => setError((e as Error).message));
  };
  return (
    <>
      <div role="radiogroup" aria-label="What it can do" className={CARD}>
        {(Object.keys(ACCESS_LABEL) as AccessLevel[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={access === k} disabled={!canEdit} onClick={() => pick(k)} className={ROW}>
            <span className={cx("shrink-0", k === "full" ? "text-warn" : "text-muted")}>{k === "full" ? <ShieldAlert size={16} /> : k === "read-only" ? <Eye size={16} /> : <Shield size={16} />}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{ACCESS_LABEL[k]}</span>
            {access === k && <Check size={15} className="shrink-0" aria-hidden />}
          </button>
        ))}
      </div>
      {error && <p className="px-1 text-xs text-bad">{error}</p>}
    </>
  );
}

/** The rest of the agent: its look and voice, who it answers, schedules, activity, connecting an app to it, removing it; and how calls with it sound. */
function MoreSheet({ agent, page }: { agent: Agent; page: (t: AgentTab) => string }) {
  const routines = useFeature("routines");
  const background = useFeature("background");
  const me = useStore((s) => s.me);
  const members = useStore((s) => s.members);
  const teams = useTeams();
  const dm = useStore((s) => s.channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agent.id}`)));
  const onTeams = teams.filter((t) => t.members.some((m) => m.agentId === agent.id)).map((t) => t.name);
  // "Only you", "Anyone", or the people picked: whose messages wake it
  const to = agent.settings.respondTo ?? "anyone";
  const mine = agent.settings.createdBy ? agent.settings.createdBy === me?.user.id : me?.role === "owner";
  const picked = (agent.settings.respondPeople ?? []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  const answers = to === "anyone" ? "Anyone" : to === "people" ? (picked.length ? `${mine ? "You, " : ""}${picked.join(", ")}` : "Picked people") : mine ? "Only you" : "Only its creator";
  return (
    <div className="space-y-3">
      <div className={CARD}>
        <PanelRow label="Look and voice" href={page("look")} />
        <PanelRow label="Who can ask it" value={answers} href={page("access")} />
        <div className="flex h-[46px] w-full items-center gap-3 px-3.5 text-[14px]">
          <span className="min-w-0 flex-1 truncate font-medium">Notifications</span>
          <Toggle label={`Notifications from ${agent.name}`} on={dm ? dm.notify !== "mute" : true} disabled={!dm} onChange={(v) => dm && void setChannelPrefs(dm, { notify: v ? "default" : "mute" })} />
        </div>
        {routines && <PanelRow label="Routines" href={page("routines")} />}
        {background && <PanelRow label="Background checks" href={page("background")} />}
        <PanelRow label="What it watches" href={page("watches")} />
        <PanelRow label="Activity" href={page("runs")} />
        <PanelRow label="Connect" href={page("connect")} />
        <PanelRow label="Remove" href={page("remove")} />
      </div>
      <div className={CARD}>
        <FactRow label="Handle" value={`@${agent.handle}`} />
        {onTeams.length > 0 && <FactRow label="Teams" value={onTeams.join(", ")} />}
      </div>
      <h3 className="px-1 pt-1 text-[13px] font-semibold text-muted">Calls</h3>
      <div className="rounded-[12px] bg-card p-3.5">
        <Suspense fallback={null}>
          <CallOptions />
        </Suspense>
      </div>
    </div>
  );
}

/** The one thing to do about an unfinished helper, in plain words. Mirrors agentReadiness's order of checks; null when ready. */
export function setupNextStep(agent: Pick<Agent, "id" | "nodeId" | "harness" | "name" | "settings" | "computerId"> & Partial<Pick<Agent, "signIn">>, devices: DeviceInfo[] | null): { text: string; href: string; action: string } | null {
  if (agentReadiness(agent, devices).ready) return null;
  if (!agent.nodeId) return { text: `Choose the computer that runs ${agent.name}.`, href: href({ view: "agents", agentId: agent.id, tab: "device" }), action: "Choose a device" };
  const device = devices?.find((d) => d.id === agent.nodeId);
  if (!device) return null;
  if (!device.online) return { text: `Open Bubble AI on ${device.name} so it reconnects. Messages wait until then.`, href: href({ view: "computers", computerId: null }), action: "See computers" };
  if (device.paused) return { text: `${device.name} is paused. Resume it on that computer.`, href: href({ view: "computers", computerId: null }), action: "See computers" };
  if (agent.signIn) return { text: `Sign in to ${harnessLabel(agent.harness)} on ${agent.signIn.where} so ${agent.name} can answer.`, href: href(agent.signIn.computerId ? { view: "agents", agentId: agent.id, tab: "computer" } : { view: "settings", page: "harnesses" }), action: "Sign in" };
  if (agentSignedIn(agent, device) === false) {
    const inVm = agent.settings?.runIn === "computer" && !!agent.computerId;
    return { text: `Sign in to ${harnessLabel(agent.harness)} ${inVm ? `on ${agent.name}'s computer` : `on ${device.name}`} so ${agent.name} can answer.`, href: href(inVm ? { view: "agents", agentId: agent.id, tab: "computer" } : { view: "settings", page: "harnesses" }), action: "Sign in" };
  }
  return { text: `Install ${harnessLabel(agent.harness)} on ${device.name}.`, href: href({ view: "settings", page: "harnesses" }), action: "Install it" };
}

/** "Setup incomplete · my-mac is offline": what's still missing before it can answer. */
export function SetupIncomplete({ problem }: { problem: string | null }) {
  return <Pill tone="warn">{problem ? `Setup incomplete · ${problem}` : "Setup incomplete"}</Pill>;
}

// --- computer ------------------------------------------------------------------------------------

function ComputerCard({ agent, computer: c }: { agent: Agent; computer: ComputerInfo }) {
  const state = useComputerState(c);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asleep = c.online && c.status === "stopped";
  const live = c.online && !c.paused && c.status !== "stopped" && c.status !== "starting";

  const wake = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/computers/${c.id}/start`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {c.help && c.help.agentId === agent.id && (
        <div className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-medium">Needs you: </span>
          {c.help.request}
        </div>
      )}
      <div className="group relative aspect-[16/10] rounded-2xl bg-panel border border-line overflow-hidden">
        {live && !open ? (
          <>
            <LiveScreen computer={c} control={false} compact />
            <button onClick={() => setOpen(true)} className="absolute inset-0" aria-label={`Open ${c.name} full screen`} />
            <span className="pointer-events-none absolute top-2 right-2 size-8 rounded-full bg-black/55 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Maximize2 size={14} />
            </span>
          </>
        ) : live && open ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">Open full screen</div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            {c.status === "starting" ? (
              <>
                <Loader2 size={22} className="animate-spin text-muted" />
                <p className="text-sm text-muted">{c.statusText || "Waking up…"}</p>
              </>
            ) : (
              <>
                <Ghost look={asleep ? (agent.settings.appearance ?? defaultAppearance(agent.handle)) : { ...(agent.settings.appearance ?? defaultAppearance(agent.handle)), color: "#8d8d8d", color2: undefined }} size={56} mood="asleep" ambient={false} label="asleep" />
                <p className="font-medium">{asleep ? "Asleep" : c.paused ? "Paused" : "Offline"}</p>
                {asleep && (
                  <Button onClick={wake} disabled={busy}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null} Wake
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 text-sm text-muted">
        {c.name}'s screen
        {state.working ? <WorkingBadge text={c.activity?.text ?? "Working"} /> : null}
      </div>
      {error && <p className="text-sm text-bad text-center">{error}</p>}
      {open && <ComputerFullscreen agent={agent} computer={c} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The computer, big. Click the screen to take control; it's yours (blue ring) until you hand it
 * back, leave it alone for a while, or the agent needs it after you've stopped using it.
 */
export function ComputerFullscreen({ agent, computer: c, onClose }: { agent: Agent; computer: ComputerInfo; onClose: () => void }) {
  const me = useStore((s) => s.me);
  const state = useComputerState(c);
  const [error, setError] = useState<string | null>(null);
  const mine = !!me && c.controller?.id === me.user.id;
  const canControl = me?.role !== "guest" && c.online && !c.paused;
  const someoneElse = !!c.controller && !mine;
  const teach = useFeature("teach");
  const touched = useRef(0);

  const control = async (take: boolean) => {
    setError(null);
    try {
      await api("POST", `/api/computers/${c.id}/control`, { take });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  // while you work on it, tell the hub now and then that you're still there (VNC input skips the hub)
  const activity = () => {
    if (Date.now() - touched.current < 15_000) return;
    touched.current = Date.now();
    void api("POST", `/api/computers/${c.id}/control`, { take: true }).catch(() => {});
  };
  // leaving the big view gives the computer back, so agents aren't stuck waiting on a closed window
  const close = () => {
    if (mine) void api("POST", `/api/computers/${c.id}/control`, { take: false }).catch(() => {});
    onClose();
  };
  const overlayId = useRef(Symbol("screen")).current;
  useOverlay(overlayId, "screen");
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // while in control, Escape belongs to the remote computer; a dialog over the screen takes it first
      if (e.key === "Escape" && !mine && isTopOverlay(overlayId)) close();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  return toBody(
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col p-3 md:p-5 safe-top safe-bottom" role="dialog" aria-modal="true" aria-label={`${c.name}'s screen`}>
      <div className="shrink-0 relative flex items-center gap-2 pb-3 min-h-11 text-white">
        <AgentAvatar agent={agent} size={26} live />
        <span className="font-medium truncate">{c.name}</span>
        {!mine && (state.working ? <WorkingBadge text={c.activity?.text ?? "Working"} /> : <Pill tone={state.tone}>{state.label}</Pill>)}
        {mine && (
          <div className="absolute left-1/2 top-0 -translate-x-1/2 inline-flex items-center gap-2 rounded-[8px] bg-info text-white pl-3.5 pr-1 h-9 text-sm font-medium shadow-panel" role="status">
            <Hand size={15} /> You are in control
            <button onClick={() => control(false)} className="h-7 px-3 rounded-[8px] bg-white/20 hover:bg-white/30 text-xs font-medium">
              Hand back
            </button>
          </div>
        )}
        {teach && canControl && !someoneElse && (
          <button onClick={() => go({ view: "computers", computerId: c.id, teach: agent.id })} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-[8px] border border-white/20 text-sm font-medium hover:bg-white/10" title={`Do a task once while ${agent.name} watches; it saves it as a skill`}>
            <Video size={15} /> Teach a task
          </button>
        )}
        <button onClick={close} className={cx(!(teach && canControl && !someoneElse) && "ml-auto", "size-9 rounded-[8px] hover:bg-white/10 grid place-items-center")} aria-label="Exit full screen" title="Exit full screen">
          <Minimize2 size={18} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <LiveScreen computer={c} control={mine} onTakeControl={canControl && !someoneElse ? () => void control(true) : undefined} onActivity={activity} />
      </div>
      <div className="shrink-0 mt-3 text-center text-sm text-white/70 min-h-5">
        {c.help ? (
          <span>
            <span className="font-medium text-white">{agent.name} needs you:</span> {c.help.request}
            {mine ? " Hand back when you're done." : " Click the screen to take control."}
          </span>
        ) : mine ? (
          `${agent.name} gets it back if you hand it back or stop using it.`
        ) : someoneElse ? (
          state.label
        ) : canControl ? (
          <span className="inline-flex items-center gap-1.5">
            <Eye size={14} /> Watching · click the screen to take control
          </span>
        ) : null}
      </div>
      {error && <p className="shrink-0 mt-1 text-center text-sm text-bad">{error}</p>}
    </div>,
  );
}
