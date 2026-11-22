import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Plug, Trash2, Wand2 } from "lucide-react";
import type { AccessRule, Agent, Connector, Routine, Skill } from "@wisp/core";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { go, href, type AgentTab } from "../router.ts";
import { setChannelPrefs } from "../components/Channels.tsx";
import { LEVEL_LABEL, pathLabel, subjectLabel } from "../components/AccessDialog.tsx";
import { whoCanAsk, type DeviceInfo } from "../devices.ts";
import { useFeatures } from "../features.ts";
import { AgentAvatar, cx, timeAgo } from "../components/ui.tsx";

/** What each part of the agent's page is called: a group's name for the tabs that are its rows, the part's own for the ones it opens. */
export const TAB_TITLES: Record<AgentTab, string> = {
  overview: "Overview",
  model: "Thinks with",
  device: "Works on",
  computer: "Works on",
  access: "Who can ask it",
  routines: "Schedules",
  background: "Background checks",
  memory: "Knows",
  skills: "Can use",
  apps: "Can use",
  permissions: "Asks first",
  connect: "Connect",
  runs: "Activity",
  look: "Look and voice",
  soul: "Personality",
  instructions: "Instructions",
  remove: "Remove",
};

// --- Rows -----------------------------------------------------------------------

/** A card of one-line rows, the same one the agent panel beside a chat uses. */
export const CARD = "overflow-hidden rounded-[14px] bg-card divide-y divide-line";
/** The same card for rows whose pickers drop below them: it clips nothing, so its first and last rows round their own corners. */
export const CARD_OPEN = "rounded-[14px] bg-card divide-y divide-line [&>:first-child]:rounded-t-[14px] [&>:last-child]:rounded-b-[14px]";
const LINE = "flex min-h-[46px] w-full items-center gap-3 px-3.5 py-1.5 text-left text-[14px]";
/** A small picker on the right of a row. */
export const SELECT = "h-8 min-w-0 max-w-[60vw] sm:max-w-64 rounded-lg border border-line bg-panel px-2 text-[13px] text-ink disabled:opacity-50";

/**
 * One setting on one line: its name on the left, its value or control on the right. With `to` or
 * `onClick` the whole row opens something (a chevron shows it); a state that needs fixing is in the
 * warning colour.
 */
export function Line({ label, value, warn, danger, to, onClick, icon, grow, children }: { label: ReactNode; value?: ReactNode; warn?: boolean; danger?: boolean; to?: string; onClick?: () => void; icon?: ReactNode; /** the name takes the room and the control keeps its size (a long name beside a switch or a button) */ grow?: boolean; children?: ReactNode }) {
  const opens = !!to || !!onClick;
  const right = children ?? (value != null && value !== "" ? <span className="truncate">{value}</span> : null);
  const roomy = grow || right == null;
  const inner = (
    <>
      {icon && <span className="flex shrink-0 text-muted">{icon}</span>}
      <span className={cx("min-w-0 truncate font-medium", roomy ? "flex-1" : "max-w-[62%] shrink-0", warn && "text-st-needs", danger && "text-bad")}>{label}</span>
      {right != null && <span className={cx("flex items-center justify-end gap-2 text-[13px] text-muted", roomy ? "shrink-0" : "min-w-0 flex-1")}>{right}</span>}
      {opens && <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />}
    </>
  );
  if (to) return <a href={to} className={cx(LINE, "hover:bg-hover")}>{inner}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={cx(LINE, "hover:bg-hover")}>{inner}</button>;
  return <div className={LINE}>{inner}</div>;
}

/** The rest of a group, behind one "Show all" row at its bottom. Lives inside a card, so what it shows are rows too. */
export function ShowAll({ children, open: start = false }: { children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(start);
  useEffect(() => {
    if (start) setOpen(true);
  }, [start]);
  return (
    <>
      {open && children}
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cx(LINE, "text-muted hover:bg-hover hover:text-ink")}>
        <span className="flex-1">{open ? "Show less" : "Show all"}</span>
        <ChevronDown size={15} className={cx("shrink-0 text-faint", open && "rotate-180")} aria-hidden />
      </button>
    </>
  );
}

/** A small heading over rows inside a card ("Apps", "Move to"). */
export function LineHead({ children }: { children: ReactNode }) {
  return <div className="px-3.5 pt-2.5 pb-1 text-[12px] font-medium text-faint">{children}</div>;
}

/** One of the six groups: its name, then its card. On desktops only the picked group shows, so its name is the page's heading. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="px-1 text-[13px] font-semibold text-muted md:pb-1 md:text-[19px] md:leading-[26px] md:text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cx("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "m-switch-on" : "bg-chip")}>
      <span className={cx("m-knob absolute top-[3px] left-[3px] size-5 rounded-full bg-white shadow", on && "translate-x-[18px]")} />
    </button>
  );
}

/** Text edited where it stands: it saves when you leave the field or press Enter; Escape puts it back. A save that fails puts it back too. */
export function InPlace({ value, onSave, label, placeholder, maxLength, className }: { value: string; onSave: (v: string) => Promise<unknown>; label: string; placeholder?: string; maxLength?: number; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = async () => {
    const v = draft.trim();
    if (v === value) return setDraft(value);
    try {
      await onSave(v);
    } catch {
      setDraft(value);
    }
  };
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      className={cx("min-w-0 rounded-md bg-transparent px-1.5 outline-none placeholder:text-faint hover:bg-hover focus:bg-hover", className)}
    />
  );
}

/** Its @handle, edited in place. Only a free handle with a letter a to z is saved. */
export function HandleLine({ agent }: { agent: Agent }) {
  const agents = useStore((s) => s.agents);
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [handle, setHandle] = useState(agent.handle);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setHandle(agent.handle), [agent.handle]);
  const clean = handle.trim().toLowerCase();
  const badHandle = !/^[a-z][a-z0-9-]{0,31}$/.test(clean);
  const taken = clean !== agent.handle && agents.some((a) => a.handle === clean);
  const save = async () => {
    if (clean === agent.handle) return setHandle(agent.handle);
    if (badHandle || taken) return;
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { handle: clean });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const problem = taken ? `@${clean} is taken` : badHandle ? "Start with a letter a to z" : error;
  return (
    <Line label="Handle">
      {problem && <span className="truncate text-bad">{problem}</span>}
      <span className="flex h-8 shrink-0 items-center rounded-lg border border-line bg-panel pl-2 text-ink focus-within:border-ink/40">
        <span className="text-muted" aria-hidden>
          @
        </span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setHandle(agent.handle);
          }}
          aria-label="Handle"
          aria-invalid={badHandle || taken}
          className="h-full w-32 bg-transparent pr-2 pl-0.5 text-[13px] outline-none"
        />
      </span>
    </Line>
  );
}

// --- Can use ----------------------------------------------------------------------

interface Usable {
  id: string;
  name: string;
  agentIds: string[];
  allAgents?: boolean;
  kind: "skills" | "connectors";
}

/** How many apps and how many skills show before "Show all". */
const CAN_USE_FIRST = 3;

/** Apps and skills in one list, a switch each: the ones it has first, the rest and Add behind "Show all". */
export function CanUse({ agent, all }: { agent: Agent; all?: boolean }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [apps, setApps] = useState<Connector[] | null>(null);
  const skillsVersion = useStore((s) => s.skillsVersion);
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Skill[]>("GET", "/api/skills").then(setSkills, () => setSkills([]));
    api<Connector[]>("GET", "/api/connectors").then(setApps, () => setApps([]));
  }, [agent.id, skillsVersion]);
  // what it already has comes first, as the hub last said (a flip here doesn't reorder the list under the pointer)
  const has = (i: { agentIds: string[]; allAgents?: boolean }) => !!i.allAgents || i.agentIds.includes(agent.id);
  const sorted = <T extends { agentIds: string[]; allAgents?: boolean }>(items: T[], kind: Usable["kind"]) => [...items].sort((a, b) => Number(has(b)) - Number(has(a))).map((i) => ({ ...i, kind }) as T & Usable);
  const appRows = useMemo(() => sorted(apps ?? [], "connectors"), [apps, agent.id]);
  const skillRows = useMemo(() => sorted(skills ?? [], "skills"), [skills, agent.id]);
  if (!skills || !apps) return <p className="px-1 text-[13px] text-muted">Loading…</p>;
  // an empty list means no agent has it yet, not every agent
  const isOn = (i: Usable) => local[`${i.kind}:${i.id}`] ?? i.agentIds.includes(agent.id);
  const flip = async (i: Usable, on: boolean) => {
    const key = `${i.kind}:${i.id}`;
    setError(null);
    setLocal((l) => ({ ...l, [key]: on }));
    try {
      await api(on ? "PUT" : "DELETE", `/api/${i.kind}/${i.id}/agents/${agent.id}`);
    } catch (e) {
      setLocal((l) => ({ ...l, [key]: !on }));
      setError((e as Error).message);
    }
  };
  const row = (i: Usable) => (
    <Line key={`${i.kind}:${i.id}`} grow label={i.name} icon={i.kind === "skills" ? <Wand2 size={16} /> : <Plug size={16} />}>
      {/* on for all agents: set where the item is, not per agent */}
      {i.allAgents ? (
        <>
          <span className="shrink-0 text-faint">All agents</span>
          <Toggle label={`${i.name} for ${agent.name} (on for all agents)`} on disabled onChange={() => {}} />
        </>
      ) : (
        <Toggle label={`${i.name} for ${agent.name}`} on={isOn(i)} onChange={(v) => void flip(i, v)} />
      )}
    </Line>
  );
  const rest = [...appRows.slice(CAN_USE_FIRST), ...skillRows.slice(CAN_USE_FIRST)];
  return (
    <>
      <div className={CARD}>
        {appRows.slice(0, CAN_USE_FIRST).map(row)}
        {skillRows.slice(0, CAN_USE_FIRST).map(row)}
        {appRows.length + skillRows.length === 0 && <Line label="Nothing added yet" />}
        <ShowAll open={all}>
          {rest.map(row)}
          <Line label="Add" to={href({ view: "marketplace" })} />
        </ShowAll>
      </div>
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
    </>
  );
}

// --- Knows --------------------------------------------------------------------------

interface NoteRow {
  path: string;
  title?: string;
  updatedAt?: number;
}

/** Its notes, its personality and its instructions; the newest notes and who can read them behind "Show all". */
export function Knows({ agent }: { agent: Agent }) {
  const to = (tab: AgentTab) => href({ view: "agents", agentId: agent.id, tab });
  return (
    <div className={CARD}>
      <Line label="Notes" to={`#/vault/agents/${agent.id}`} />
      <Line label="Personality" to={to("soul")} />
      <Line label="Instructions" value={agent.settings.role} to={to("instructions")} />
      <ShowAll>
        <RecentNotes agent={agent} />
        <NotesAccess agent={agent} />
      </ShowAll>
    </div>
  );
}

function RecentNotes({ agent }: { agent: Agent }) {
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  useEffect(() => {
    api<NoteRow[]>("GET", "/api/vault/notes").then((all) => setNotes(all.filter((n) => n.path.startsWith(`agents/${agent.id}/`)).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))), () => setNotes([]));
  }, [agent.id]);
  const recent = useMemo(() => (notes ?? []).filter((n) => !/\/(SOUL|About)\.md$/.test(n.path)).slice(0, 5), [notes]);
  const title = (n: NoteRow) => n.title || n.path.split("/").pop()!.replace(/\.md$/, "");
  if (!recent.length) return null;
  return (
    <>
      <LineHead>Recent notes</LineHead>
      {recent.map((n) => (
        <Line key={n.path} to={`#/vault/${n.path}`} label={title(n)} value={n.updatedAt ? timeAgo(new Date(n.updatedAt).toISOString()) : ""} />
      ))}
    </>
  );
}

/** Which memory folders and notes it can use and through what, and who its own folder is shared with. */
function NotesAccess({ agent }: { agent: Agent }) {
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const [memory, setMemory] = useState<{ rules: AccessRule[]; sharedOut: AccessRule[] } | null>(null);
  useEffect(() => {
    api<{ rules: AccessRule[]; sharedOut: AccessRule[] }>("GET", `/api/access/agents/${agent.id}`).then(setMemory, () => setMemory({ rules: [], sharedOut: [] }));
  }, [agent.id]);
  const where = (r: AccessRule) => pathLabel(r.path, agents, members) || "All memory";
  const through = (r: AccessRule) => (r.subject.kind === "agent" ? "" : ` · via ${subjectLabel(r.subject, agents, members)}`);
  return (
    <>
      <LineHead>What it can read</LineHead>
      {memory === null ? (
        <Line label="Loading…" />
      ) : (
        [...memory.rules]
          .sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()))
          .map((r) => (
            <Line
              key={`${r.path}|${r.subject.kind}|${r.id ?? "default"}`}
              label={where(r)}
              value={`${LEVEL_LABEL[r.level]}${through(r)}${r.builtin ? " · default" : r.createdBy?.kind === "agent" ? ` · shared by ${subjectLabel({ kind: "agent", id: r.createdBy.id }, agents, members)}` : ""}${r.startup ? " · always loaded" : ""}`}
            />
          ))
      )}
      <Line
        label="Its folder is shared with"
        value={memory === null ? "" : memory.sharedOut.length ? memory.sharedOut.map((r) => `${subjectLabel(r.subject, agents, members)} (${LEVEL_LABEL[r.level].toLowerCase()}${r.path !== `agents/${agent.id}` ? ` ${where(r)}` : ""})`).join(", ") : "No one else"}
      />
    </>
  );
}

// --- More ---------------------------------------------------------------------------

/** The rest of the agent: its look and voice, who it answers, what it does by itself, its activity; connecting another app and removing it last. */
export function More({ agent, nodes }: { agent: Agent; nodes: DeviceInfo[] }) {
  const channels = useStore((s) => s.channels);
  const routinesVersion = useStore((s) => s.routinesVersion);
  const features = useFeatures();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  useEffect(() => {
    if (features.routines) api<Routine[]>("GET", `/api/routines?agent=${agent.id}`).then(setRoutines, () => setRoutines([]));
  }, [agent.id, features.routines, routinesVersion]);
  const to = (tab: AgentTab) => href({ view: "agents", agentId: agent.id, tab });
  const on = routines?.filter((r) => r.enabled).length ?? 0;
  const dm = channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agent.id}`));
  const respond = whoCanAsk(agent, nodes.find((n) => n.id === agent.nodeId));
  return (
    <>
      <div className={CARD}>
        <Line label="Look and voice" to={to("look")} />
        <Line label="Who can ask it" value={respond === "me" ? "Only me" : respond === "people" ? "Picked people" : "Anyone"} to={to("access")} />
        {features.routines && <Line label="Schedules" value={routines ? (on ? `${on} on` : "None") : ""} to={to("routines")} />}
        {features.background && <Line label="Background checks" to={to("background")} />}
        <Line label="Notifications">
          <Toggle label={`Notifications from ${agent.name}`} on={dm ? dm.notify !== "mute" : true} disabled={!dm} onChange={(v) => dm && void setChannelPrefs(dm, { notify: v ? "default" : "mute" })} />
        </Line>
        <Line label="Activity" to={to("runs")} />
        <ShowAll>
          <Line label="Connect" to={to("connect")} />
        </ShowAll>
      </div>
      <a href={to("remove")} className="inline-flex h-9 items-center px-1 text-[13px] font-medium text-bad hover:underline">
        Remove {agent.name}
      </a>
    </>
  );
}

// --- Who can ask it ---------------------------------------------------------------

const ASK_ROW = "flex min-h-[46px] w-full items-center gap-3 px-3.5 text-left text-[14px] hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent";

export function AccessPanel({ agent, device }: { agent: Agent; device: DeviceInfo | undefined }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const members = useStore((s) => s.members);
  const me = useStore((s) => s.me);
  const [error, setError] = useState<string | null>(null);
  const respond = whoCanAsk(agent, device);
  // on someone else's private device only they can open it up, whatever was picked here
  const locked = !!device && !device.mine && !device.shared && !agent.settings.anyoneCanAsk && respond === "me" && !(agent.settings.runIn === "computer" && agent.computerId);
  const picked = agent.settings.respondPeople ?? [];
  const save = async (settings: { respondTo?: "me" | "anyone" | "people"; respondPeople?: string[] }) => {
    setError(null);
    try {
      await api("PATCH", `/api/agents/${agent.id}`, { settings });
      await refreshAgents();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const others = members.filter((m) => m.id !== me?.user.id);
  const options: ["me" | "anyone" | "people", string][] = [
    ["me", locked ? `Only ${device?.ownerName ?? "its owner"}` : "Only me"],
    ["anyone", "Anyone"],
    ["people", "Picked people"],
  ];
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Who can ask it" className={CARD}>
        {options.map(([v, title]) => (
          <button key={v} type="button" role="radio" aria-checked={respond === v} disabled={locked} onClick={() => void save({ respondTo: v })} className={ASK_ROW}>
            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
            {respond === v && <Check size={15} className="shrink-0" aria-hidden />}
          </button>
        ))}
      </div>
      {locked && <p className="px-1 text-[13px] text-muted">Runs on {device?.name}</p>}
      {respond === "people" &&
        (others.length ? (
          <div className={CARD}>
            {others.map((p) => {
              const on = picked.includes(p.id);
              return (
                <button key={p.id} type="button" role="checkbox" aria-checked={on} onClick={() => void save({ respondPeople: on ? picked.filter((x) => x !== p.id) : [...picked, p.id] })} className={ASK_ROW}>
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="shrink-0 text-[13px] capitalize text-muted">{p.role}</span>
                  <Check size={15} className={cx("shrink-0", !on && "invisible")} aria-hidden />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-1 text-[13px] text-muted">Nobody else is here yet</p>
        ))}
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
    </div>
  );
}

// --- Remove -----------------------------------------------------------------------------

export function RemovePanel({ agent }: { agent: Agent }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("DELETE", `/api/agents/${agent.id}`);
      await refreshAgents();
      go({ view: "agents", agentId: null });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="flex max-w-md flex-col items-center gap-3 pt-2 text-center max-md:mx-auto md:items-start md:text-left">
      <AgentAvatar agent={agent} size={64} />
      <h3 className="text-[19px] font-semibold leading-[26px]">Remove {agent.name}?</h3>
      <p className="text-[14px] leading-[22px] text-muted">Its notes and personality stay in memory. Its schedules and chats stop.</p>
      {error && <p className="text-sm text-bad">{error}</p>}
      <button onClick={remove} disabled={busy} className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-bad px-5 text-sm font-medium text-white disabled:opacity-60">
        <Trash2 size={16} /> Remove {agent.name}
      </button>
    </div>
  );
}
