import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Clock, Eye, FileText, Hand, Image as ImageIcon, Loader2, Maximize2, MessageSquarePlus } from "lucide-react";
import { harnessLabel, type AccessLevel, type Agent, type Connector, type Routine, type Skill } from "@bubble-ai/core";
import { defaultAppearance } from "@bubble-ai/core/src/appearance.ts";
import { api, fileUrl, uploadFile } from "../api.ts";
import { setAgentBackground, useChatBackground, type ChatBackground } from "../chatBackground.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { href, go, type AgentTab } from "../router.ts";
import { liveShape } from "../liveShape.ts";
import { useFeatures } from "../features.ts";
import { lazyView } from "../lazy.tsx";
import { openDm } from "../openDm.ts";
import { agentReadiness, isSharedComputer, useDevices, whoCanAsk } from "../devices.ts";
import { setChannelPrefs } from "../components/Channels.tsx";
import { LiveScreen, WorkingBadge } from "../components/Screen.tsx";
import { ComputerFullscreen } from "../components/AgentPanel.tsx";
import { Ghost } from "../components/Ghost.tsx";
import { FilePreview } from "../components/FilePreview.tsx";
import { fileKind } from "../components/fileKind.ts";
import { stopRuns, workDetail } from "../components/ActivityPill.tsx";
import { minutesSince, runStartedAt } from "../components/agentActivity.ts";
import { effortName, prettyModel } from "../components/EffortSlider.tsx";
import { Button, cx, timeAgo } from "../components/ui.tsx";
import { VoicePicker } from "../voice/VoicePicker.tsx";
import { CARD, Line, Toggle } from "./AgentSections.tsx";
import { runsOnDevice, type RoutineDraft } from "./AgentComputer.tsx";

/** The profile's six tabs, in order. */
export const PROFILE_TABS = ["activity", "library", "computer", "voice", "background", "settings"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
export const PROFILE_TAB_TITLES: Record<ProfileTab, string> = { activity: "Activity", library: "Library", computer: "Computer", voice: "Voice", background: "Background", settings: "Settings" };

/** The address of each tab (#/agents/<id>/<tab>); Activity is the profile's own address. */
export const PROFILE_TAB_ROUTE: Record<ProfileTab, AgentTab> = { activity: "overview", library: "library", computer: "screen", voice: "voice", background: "wallpaper", settings: "settings" };

/** Parts a Settings row opens inside the profile, with a back arrow. Look is opened from the avatar. */
export const PROFILE_PARTS: readonly AgentTab[] = ["model", "harness", "effort", "device", "computer", "apps", "skills", "permissions", "memory", "soul", "instructions", "routines", "watches", "access", "connect", "background", "look"];

/**
 * Where an address lands in the profile: its tab, and the part open over it (null for the tab itself).
 * Old addresses keep working: the 12-tab page's tabs and the six groups' rows all open their part.
 */
export function profilePlace(tab: AgentTab | null | undefined): { tab: ProfileTab; part: AgentTab | null } {
  switch (tab) {
    case null:
    case undefined:
    case "overview":
    case "runs":
      return { tab: "activity", part: null };
    case "library":
      return { tab: "library", part: null };
    case "screen":
      return { tab: "computer", part: null };
    case "voice":
      return { tab: "voice", part: null };
    case "wallpaper":
      return { tab: "background", part: null };
    case "settings":
    case "remove":
      return { tab: "settings", part: null };
    default:
      return { tab: "settings", part: PROFILE_PARTS.includes(tab) ? tab : null };
  }
}

const ACCESS_LABEL: Record<AccessLevel, string> = { "read-only": "Read only", edit: "Can edit files", full: "Full access" };

/** A card of one-line rows with a small heading over it. */
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      {title && <h3 className="px-1 text-[12px] font-semibold text-muted">{title}</h3>}
      {children}
    </section>
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

/** How long a run took, in words ("under a second", "12 seconds", "3 minutes"). */
export function tookFor(ms: number): string {
  const secs = Math.round(Math.max(0, ms) / 1000);
  if (secs < 1) return "under a second";
  if (secs < 60) return secs === 1 ? "1 second" : `${secs} seconds`;
  const mins = Math.round(secs / 60);
  return mins === 1 ? "1 minute" : `${mins} minutes`;
}

const RUN_DOT: Record<string, string> = { done: "var(--status-online)", failed: "var(--status-error)", running: "var(--status-working)", queued: "var(--status-paused)", cancelled: "var(--status-idle)" };

/** The routine "Create a routine" starts with: every weekday at 8, a plan for the day. */
export const SUGGESTED_ROUTINE: RoutineDraft = { result: "Send me a plan for the day", schedule: "0 8 * * 1-5" };

/**
 * What it has been doing: what it's on right now (with Stop), two suggestions (a routine, something
 * to watch), then its recent runs, each opening the chat it was in; one that didn't finish has Try again.
 */
export function ActivityTab({ agent, onRoutine, onWatch }: { agent: Agent; onRoutine: () => void; onWatch: () => void }) {
  const features = useFeatures();
  const live = useStore(liveShape);
  const agents = useStore((s) => s.agents);
  const canEdit = useStore((s) => s.me?.role !== "guest");
  const runsNow = Object.values(live).filter((r) => r.agentId === agent.id);
  const run = runsNow.at(-1);
  const since = runsNow.length ? Math.min(...runsNow.map((r) => runStartedAt(r.runId))) : null;
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<RunRow[]>("GET", `/api/agents/${agent.id}/runs?limit=50`).then(setRuns, () => setRuns([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, runsNow.length]);
  const retry = async (r: RunRow) => {
    setError(null);
    try {
      await api("POST", `/api/runs/${r.id}/retry`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="space-y-5">
      {(run || agent.status === "busy") && (
        <div className={cx(CARD, "flex min-h-[46px] items-center gap-3 px-3.5 text-[14px]")} role="status">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-st-working" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {run ? workDetail(run, agents) : "Working"}
            {since ? <span className="text-muted"> · {minutesSince(since)}</span> : null}
          </span>
          {runsNow.length > 0 && canEdit && (
            <button type="button" onClick={() => void stopRuns(runsNow)} className="shrink-0 text-[13px] font-medium text-ink hover:underline">
              Stop
            </button>
          )}
        </div>
      )}
      {canEdit && (
        <Section title="Suggested">
          <div className={CARD}>
            {features.routines && <Suggestion icon={<Clock size={18} strokeWidth={1.8} />} title="Create a routine" detail="Every weekday at 8am, send me a plan for the day" onClick={onRoutine} />}
            <Suggestion icon={<Eye size={18} strokeWidth={1.8} />} title="Watch something" detail="Tell me when something new lands in an app" onClick={onWatch} />
          </div>
        </Section>
      )}
      <Section title="Recent">
        {runs === null ? (
          <p className="px-1 text-[13px] text-muted">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="px-1 text-[13px] text-muted">Nothing yet</p>
        ) : (
          <div className={CARD}>
            {runs.map((r) => {
              const why = r.hint || r.error;
              const took = r.finishedAt ? tookFor(new Date(r.finishedAt).getTime() - new Date(r.createdAt).getTime()) : null;
              const where = r.channelKind === "dm" ? "Chat" : r.channelName ? `#${r.channelName}` : "";
              const title = r.kind === "background" ? "Background check" : runTitle(r.trigger) || "Message";
              return (
                <div key={r.id} className="flex min-h-[46px] items-center gap-3 px-3.5 py-2 text-[14px]">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: RUN_DOT[r.status] ?? RUN_DOT.cancelled }} title={runStatusLabel(r.status)} aria-label={runStatusLabel(r.status)} />
                  <span className="min-w-0 flex-1">
                    <a href={`#/c/${r.channelId}${r.threadId ? `/t/${r.threadId}` : ""}`} title={[where, took ? `took ${took}` : null, `run ${r.id}`].filter(Boolean).join(" · ")} className="block truncate hover:underline">
                      {title}
                    </a>
                    {why && <span className="block truncate text-[12.5px] text-bad">{why.replace(/`/g, "")}</span>}
                  </span>
                  {r.status === "failed" && r.channelName !== null && canEdit && (
                    <button type="button" className="shrink-0 text-[13px] font-medium text-ink hover:underline" onClick={() => void retry(r)}>
                      Try again
                    </button>
                  )}
                  <span className="w-[72px] shrink-0 text-right text-[13px] text-muted">{timeAgo(r.createdAt)}</span>
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
      </Section>
    </div>
  );
}

function Suggestion({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] hover:bg-hover">
      <span className="flex shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-[13px] text-muted">{detail}</span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />
    </button>
  );
}

// --- Library ------------------------------------------------------------------

interface NoteRow {
  path: string;
  title?: string;
  updatedAt?: number;
}
interface SharedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  uploaderKind: string;
  uploaderId: string;
  createdAt: string;
}
type LibraryItem = { kind: "note"; key: string; name: string; at: number; path: string } | { kind: "file"; key: string; name: string; at: number; id: string };

/** Its files: the notes in its memory folder (not its personality) and the files it sent in chats, newest first. */
export function libraryItems(agentId: string, notes: NoteRow[], files: SharedFile[]): LibraryItem[] {
  const own = notes
    .filter((n) => n.path.startsWith(`agents/${agentId}/`) && !/\/(SOUL|About)\.md$/.test(n.path))
    .map((n): LibraryItem => ({ kind: "note", key: `n:${n.path}`, name: n.title || n.path.split("/").pop()!, at: n.updatedAt ?? 0, path: n.path }));
  const sent = files.filter((f) => f.uploaderKind === "agent" && f.uploaderId === agentId).map((f): LibraryItem => ({ kind: "file", key: `f:${f.id}`, name: f.name, at: Date.parse(f.createdAt) || 0, id: f.id }));
  return [...own, ...sent].sort((a, b) => b.at - a.at);
}

/** Its files as a grid: what's in its memory folder and what it shared in chats. A click opens one. */
export function LibraryTab({ agent }: { agent: Agent }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    let on = true;
    Promise.all([api<NoteRow[]>("GET", "/api/vault/notes").catch(() => []), api<SharedFile[]>("GET", "/api/files").catch(() => [])]).then(([notes, files]) => on && setItems(libraryItems(agent.id, notes, files)));
    return () => {
      on = false;
    };
  }, [agent.id]);
  if (!items) return <p className="px-1 text-[13px] text-muted">Loading…</p>;
  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="px-1 text-[13px] text-muted">No files yet</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => (it.kind === "note" ? go({ view: "vault", path: it.path }) : setPreview({ id: it.id, name: it.name }))}
              className="flex min-w-0 flex-col gap-2 rounded-[12px] bg-card p-2.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <Thumb item={it} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{it.name.replace(/\.md$/, "")}</span>
                <span className="block truncate text-[12px] text-muted">{it.at ? timeAgo(new Date(it.at).toISOString()) : it.kind === "note" ? "Note" : "File"}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <Line label={`${agent.name}'s memory folder`} to={`#/vault/agents/${agent.id}`} />
      {preview && <FilePreview id={preview.id} name={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** A tile's picture: an image file shows itself; anything else a plain line icon. */
function Thumb({ item }: { item: LibraryItem }) {
  const image = item.kind === "file" && fileKind(item.name) === "image";
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!image || item.kind !== "file") return;
    let url: string | null = null;
    let gone = false;
    fileUrl(item.id).then(
      (u) => (gone ? URL.revokeObjectURL(u) : setSrc((url = u))),
      () => {},
    );
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image, item]);
  return (
    <span className="grid h-[84px] place-items-center overflow-hidden rounded-[8px] bg-hover text-faint">
      {src ? <img src={src} alt="" className="size-full object-cover" /> : image ? <ImageIcon size={24} strokeWidth={1.6} /> : <FileText size={24} strokeWidth={1.6} />}
    </span>
  );
}

// --- Computer -----------------------------------------------------------------

/** Its own screen, live: open it full screen, or take control. Without a computer, where to give it one. */
export function ScreenTab({ agent }: { agent: Agent }) {
  const computer = useStore((s) => s.computers.find((c) => c.id === agent.computerId));
  const me = useStore((s) => s.me);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toComputer = href({ view: "agents", agentId: agent.id, tab: "computer" });
  if (!computer)
    return (
      <div className="space-y-3">
        <p className="px-1 text-[13px] text-muted">{agent.name} has no computer yet</p>
        <div className={CARD}>
          <Line label="Give it a computer" to={toComputer} />
        </div>
      </div>
    );
  const c = computer;
  const live = c.online && !c.paused && c.status !== "stopped" && c.status !== "starting";
  const canControl = me?.role !== "guest" && c.online && !c.paused && !(c.controller && c.controller.id !== me?.user.id);
  const takeControl = async () => {
    setError(null);
    setBusy(true);
    try {
      await api("POST", `/api/computers/${c.id}/control`, { take: true });
      setFull(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      {c.help && c.help.agentId === agent.id && (
        <div className="rounded-[12px] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-[14px]">
          <span className="font-medium">Needs you: </span>
          {c.help.request}
        </div>
      )}
      <ScreenBox agent={agent} computer={c} live={live} onOpen={() => setFull(true)} />
      <div className={CARD}>
        <Line label={`${agent.name}'s screen`} value={isSharedComputer(c) ? "On the shared computer" : c.name} to={toComputer} />
        {live && canControl && (
          <Line label="Take control" icon={busy ? <Loader2 size={16} className="animate-spin" /> : <Hand size={16} />} onClick={() => void takeControl()} />
        )}
        {live && <Line label="Open full screen" icon={<Maximize2 size={16} />} onClick={() => setFull(true)} />}
      </div>
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
      {full && <ComputerFullscreen agent={agent} computer={c} onClose={() => setFull(false)} />}
    </div>
  );
}

function ScreenBox({ agent, computer: c, live, onOpen }: { agent: Agent; computer: ComputerInfo; live: boolean; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asleep = c.online && c.status === "stopped";
  const look = agent.settings.appearance ?? defaultAppearance(agent.handle);
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
    <div className="group relative aspect-[16/10] overflow-hidden rounded-[14px] border border-line bg-[#2b2d33]">
      {live ? (
        <>
          <LiveScreen computer={c} control={false} compact />
          <button type="button" onClick={onOpen} className="absolute inset-0" aria-label={`Open ${agent.name}'s screen full screen`} />
          <span className="pointer-events-none absolute left-2.5 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-0.5 text-[12px] text-white">
            <span className="size-1.5 rounded-full bg-[var(--status-online)]" aria-hidden /> Live
          </span>
          {c.activity?.text && (
            <span className="pointer-events-none absolute bottom-2 left-2.5">
              <WorkingBadge text={c.activity.text} />
            </span>
          )}
          <span className="pointer-events-none absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Maximize2 size={14} />
          </span>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white/80">
          {c.status === "starting" ? (
            <>
              <Loader2 size={22} className="animate-spin" />
              <p className="text-[13px]">{c.statusText || "Waking up…"}</p>
            </>
          ) : (
            <>
              <Ghost look={asleep ? look : { ...look, color: "#8d8d8d", color2: undefined }} size={52} mood="asleep" ambient={false} label="asleep" />
              <p className="text-[14px] font-medium text-white">{asleep ? "Asleep" : c.paused ? "Paused" : "Offline"}</p>
              {asleep && (
                <Button onClick={() => void wake()} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null} Wake
                </Button>
              )}
              {error && <p className="text-[13px] text-bad">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Voice --------------------------------------------------------------------

const CallOptions = lazyView(() => import("../voice/CallScreen.tsx").then((m) => m.CallOptions));

/** How it sounds: its voice (each with Listen), saved as you pick; then calls' language and speed. */
export function VoiceTab({ agent }: { agent: Agent }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [voice, setVoice] = useState(agent.settings.voice ?? {});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setVoice(agent.settings.voice ?? {}), [agent.settings.voice]);
  const pick = async (next: NonNullable<Agent["settings"]["voice"]>) => {
    setVoice(next);
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { settings: { voice: next } });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="space-y-5">
      <VoicePicker agent={agent} value={voice} onChange={(v) => void pick(v)} onLevel={() => {}} bare />
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
      <Section title="Calls">
        <div className="rounded-[12px] bg-card p-3.5">
          <Suspense fallback={null}>
            <CallOptions />
          </Suspense>
        </div>
      </Section>
    </div>
  );
}

// --- Background -----------------------------------------------------------------

/** Colours for a chat background, light to dark. */
export const BACKGROUND_SWATCHES: readonly [string, string][] = [
  ["#dfe4f3", "Mist"],
  ["#f3e3dc", "Peach"],
  ["#e2f0e6", "Mint"],
  ["#efe4f7", "Lilac"],
  ["#f6efd9", "Sand"],
  ["#dcebf5", "Sky"],
  ["#2a2d35", "Night"],
  ["#1c1c1c", "Black"],
];

/** A photo from the hub, as an object URL while shown. */
function usePhoto(fileId: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!fileId) return;
    let url: string | null = null;
    let gone = false;
    fileUrl(fileId).then(
      (u) => (gone ? URL.revokeObjectURL(u) : setSrc((url = u))),
      () => {},
    );
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);
  return src;
}

/** This agent's chat background: None, a Photo (file picker) or a Colour (swatches). */
export function BackgroundTab({ agent }: { agent: Agent }) {
  const bg = useChatBackground(agent.id);
  const [mode, setMode] = useState<"none" | "photo" | "color">(bg?.kind ?? "none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setMode(bg?.kind ?? "none"), [bg?.kind]);
  const photo = usePhoto(bg?.kind === "photo" ? bg.fileId : null);
  const colour = bg?.kind === "color" ? bg.color : BACKGROUND_SWATCHES[0][0];

  const save = async (next: ChatBackground | null) => {
    setError(null);
    try {
      await setAgentBackground(agent.id, next);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadFile(file);
      await save({ kind: "photo", fileId: up.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const options = [
    { id: "none" as const, name: "None", face: "bg-hover", style: undefined, pick: () => void save(null) },
    { id: "photo" as const, name: "Photo", face: "bg-hover", style: photo ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined, pick: () => input.current?.click() },
    { id: "color" as const, name: "Colour", face: "", style: { background: colour }, pick: () => (setMode("color"), void save({ kind: "color", color: colour })) },
  ];

  return (
    <div className="pt-2">
      <div className="flex justify-center gap-4 sm:gap-6" role="radiogroup" aria-label={`${agent.name}'s chat background`}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={mode === o.id} onClick={o.pick} className="group flex flex-col items-center gap-2 outline-none">
            <span className={cx("block rounded-full border-[3px] p-1 transition-colors", mode === o.id ? "border-ink" : "border-transparent group-hover:border-line group-focus-visible:border-line")}>
              <span className={cx("grid size-20 place-items-center rounded-full text-faint ring-1 ring-line sm:size-24", o.face)} style={o.style}>
                {o.id === "photo" && !photo && (busy ? <Loader2 size={24} className="animate-spin" /> : <ImageIcon size={28} strokeWidth={1.6} />)}
              </span>
            </span>
            <span className="text-[13px] font-medium text-ink">{o.name}</span>
          </button>
        ))}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => (void choose(e.target.files?.[0]), (e.target.value = ""))} />
      {mode === "color" && (
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {BACKGROUND_SWATCHES.map(([c, name]) => (
            <button
              key={c}
              type="button"
              aria-label={name}
              aria-pressed={c === colour}
              onClick={() => void save({ kind: "color", color: c })}
              className={cx("size-8 rounded-full border-2 border-panel outline-none", c === colour ? "ring-2 ring-ink" : "ring-1 ring-line hover:ring-faint focus-visible:ring-faint")}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
      {mode === "photo" && photo && (
        <p className="mt-4 text-center">
          <button type="button" onClick={() => input.current?.click()} className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline">
            Choose another photo
          </button>
        </p>
      )}
      {error && <p className="mt-4 text-center text-[13px] text-bad">{error}</p>}
      <p className="mt-6 text-center text-[12.5px] text-faint">{agent.name}'s chat only · the default for every chat is in Settings</p>
    </div>
  );
}

// --- Settings -----------------------------------------------------------------

/**
 * Every setting as one row in four cards, each opening its part (with a back arrow): how it thinks
 * (Model, Harness, Effort), where and with what it works (Computer, Apps and skills, Permissions),
 * what it knows (Memory, Personality, Instructions), and how it's reached (Routines, Watches, Who
 * can message, Notifications, Connections); then Remove.
 */
export function SettingsTab({ agent }: { agent: Agent }) {
  const features = useFeatures();
  const devices = useDevices();
  const me = useStore((s) => s.me);
  const members = useStore((s) => s.members);
  const computers = useStore((s) => s.computers);
  const routinesVersion = useStore((s) => s.routinesVersion);
  const skillsVersion = useStore((s) => s.skillsVersion);
  const dm = useStore((s) => s.channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agent.id}`)));
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [usable, setUsable] = useState<string[] | null>(null);
  const [watching, setWatching] = useState<string[] | null>(null);
  useEffect(() => {
    if (features.routines) api<Routine[]>("GET", `/api/routines?agent=${agent.id}`).then(setRoutines, () => setRoutines([]));
  }, [agent.id, features.routines, routinesVersion]);
  useEffect(() => {
    const has = (i: { agentIds: string[]; allAgents?: boolean }) => !!i.allAgents || i.agentIds.includes(agent.id);
    Promise.all([api<Connector[]>("GET", "/api/connectors").catch(() => []), api<Skill[]>("GET", "/api/skills").catch(() => [])]).then(([apps, skills]) => setUsable([...apps.filter(has), ...skills.filter(has)].map((i) => i.name)));
  }, [agent.id, skillsVersion]);
  useEffect(() => {
    api<{ watches: { label: string; agentIds: string[] }[] }>("GET", "/api/watches").then((r) => setWatching(r.watches.filter((w) => w.agentIds.includes(agent.id)).map((w) => w.label)), () => setWatching([]));
  }, [agent.id]);

  const to = (t: AgentTab) => href({ view: "agents", agentId: agent.id, tab: t });
  const device = devices?.find((d) => d.id === agent.nodeId);
  const computer = computers.find((c) => c.id === agent.computerId);
  const readiness = agentReadiness(agent, devices);
  const headless = runsOnDevice(agent.harness);
  const list = (names: string[] | null) => (!names ? "" : names.length === 0 ? "None" : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`);
  const on = routines?.filter((r) => r.enabled).length ?? 0;
  // "Only you", "Anyone", or the people picked: whose messages wake it
  const respond = whoCanAsk(agent, device);
  const mine = agent.settings.createdBy ? agent.settings.createdBy === me?.user.id : me?.role === "owner";
  const picked = (agent.settings.respondPeople ?? []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  const who = respond === "anyone" ? "Anyone" : respond === "people" ? (picked.length ? `${mine ? "You, " : ""}${picked.join(", ")}` : "Picked people") : mine ? "Only you" : "Only its creator";
  return (
    <div className="space-y-3">
      <div className={CARD}>
        <Line label="Model" value={headless ? (agent.model ? prettyModel(agent.model) : "Automatic") : `Set in ${harnessLabel(agent.harness)}`} to={to("model")} />
        <Line label="Harness" value={harnessLabel(agent.harness)} to={to("harness")} />
        {headless && <Line label="Effort" value={agent.settings.effort ? effortName(agent.settings.effort) : "Default"} to={to("effort")} />}
      </div>
      <div className={CARD}>
        <Line label="Computer" value={!readiness.ready ? (readiness.problem ?? "Setup incomplete") : (computer?.name ?? device?.name ?? "None yet")} warn={!readiness.ready} to={to("computer")} />
        <Line label="Apps and skills" value={list(usable)} to={to("apps")} />
        <Line label="Permissions" value={ACCESS_LABEL[agent.settings.access ?? "edit"]} to={to("permissions")} />
      </div>
      <div className={CARD}>
        <Line label="Memory" to={to("memory")} />
        <Line label="Personality" to={to("soul")} />
        <Line label="Instructions" to={to("instructions")} />
      </div>
      <div className={CARD}>
        {features.routines && <Line label="Routines" value={routines ? (on ? `${on} on` : "None") : ""} to={to("routines")} />}
        <Line label="Watches" value={list(watching)} to={to("watches")} />
        <Line label="Who can message" value={who} to={to("access")} />
        <Line label="Notifications" grow>
          <Toggle label={`Notifications from ${agent.name}`} on={dm ? dm.notify !== "mute" : true} disabled={!dm} onChange={(v) => dm && void setChannelPrefs(dm, { notify: v ? "default" : "mute" })} />
        </Line>
        <Line label="Connections" to={to("connect")} />
      </div>
      <a href={to("remove")} className={cx(CARD, "flex min-h-[46px] items-center justify-center text-[14px] font-medium text-bad hover:bg-hover")}>
        Remove {agent.name}
      </a>
    </div>
  );
}

/** In Watches: ask it, in its chat, to keep an eye on something new. */
export function WatchSomething({ agent }: { agent: Agent }) {
  return (
    <div className={CARD}>
      <Line label="Watch something new" icon={<MessageSquarePlus size={16} />} onClick={() => void openDm(agent.id, "Keep an eye on ")} />
    </div>
  );
}
