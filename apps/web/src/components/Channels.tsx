import { Suspense, useEffect, useMemo, useState } from "react";
import { Check, Hash, Lock, Plus, Search, UserPlus, X } from "lucide-react";
import { teamProblem, type ChannelNotify, type ChannelTeam, type Section } from "@bubble-ai/core";
import { EMPTY_TEAM, TeamChart, addToTeam, liveTeam } from "./TeamChart.tsx";
import { api } from "../api.ts";
import { useNames, useStore, type ChannelInfo } from "../store.ts";
import { liveShape } from "../liveShape.ts";
import { lazyView } from "../lazy.tsx";
import { go } from "../router.ts";
import { AgentAvatar, Button, Field, Input, Modal, Textarea, UserAvatar, cx } from "./ui.tsx";
import { TeamPanel, type TeamSheet } from "./TeamInfo.tsx";

// Making a team, and making an agent for one, bring the whole team builder and the new-agent pages
// with them: files of their own, fetched in the background after the app is up (lazy.tsx).
const NewTeamFlow = lazyView(() => import("../team/Create.tsx").then((m) => m.NewTeamFlow));
const NewAgentForTeam = lazyView(() => import("../team/NewAgent.tsx").then((m) => m.NewAgentForTeam));

// the same rule as `teamSlug` in team/Create.tsx, kept here so a search doesn't fetch the builder
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** A channel's icon: a lock for a private one, a hash otherwise. */
export function ChannelIcon({ channel, size = 14, className = "text-faint" }: { channel: Pick<ChannelInfo, "private">; size?: number; className?: string }) {
  return channel.private ? <Lock size={size} className={className} aria-label="Private" /> : <Hash size={size} className={className} />;
}

/** #general stays public (it can be archived or deleted like any other channel). */
export function isProtected(channel: ChannelInfo) {
  return channel.name === "general";
}

/** Your own settings for a channel: how much it tells you, and whether it's starred. */
export async function setChannelPrefs(channel: ChannelInfo, patch: { notify?: ChannelNotify; starred?: boolean }) {
  const before = useStore.getState().channels.find((c) => c.id === channel.id) ?? channel;
  // show it straight away; the list refresh confirms it
  useStore.setState((s) => ({ channels: s.channels.map((c) => (c.id === channel.id ? { ...c, ...patch, ...(patch.notify === "mute" ? { unread: 0 } : {}) } : c)) }));
  try {
    await api("PUT", `/api/channels/${channel.id}/prefs`, patch);
  } catch (e) {
    useStore.setState((s) => ({ channels: s.channels.map((c) => c.id === channel.id ? {
      ...c,
      ...(patch.starred !== undefined && c.starred === patch.starred ? { starred: before.starred } : {}),
      ...(patch.notify !== undefined && c.notify === patch.notify ? { notify: before.notify, ...(patch.notify === "mute" && c.unread === 0 ? { unread: before.unread } : {}) } : {}),
    } : c) }));
    alert((e as Error).message);
    return;
  }
  await useStore.getState().refreshChannels();
}

export async function setArchived(channel: ChannelInfo, archived: boolean) {
  await api("POST", `/api/channels/${channel.id}/archive`, { archived });
  await useStore.getState().refreshChannels();
}

export const NOTIFY: Record<ChannelNotify, { label: string; body: string }> = {
  all: { label: "Every message", body: "Get a notification whenever an agent posts here." },
  default: { label: "Just what's for me", body: "Answers to what you asked, and agents asking for your OK." },
  mute: { label: "Mute", body: "No unread badge and no notifications. Agents asking for your OK still reach you." },
};

export { NewAgentForTeam };

/** "Add a channel": one box to search, join, or create (Buzz-style). Creating is the New team flow (team/Create.tsx). */
export function ChannelBrowser({ onClose, sectionId = null, create: startCreating = false }: { onClose: () => void; sectionId?: string | null; create?: boolean }) {
  const channels = useStore((s) => s.channels).filter((c) => c.kind === "channel");
  const refreshChannels = useStore((s) => s.refreshChannels);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "joined" | "archived">("all");
  const [step, setStep] = useState<"browse" | "about">(startCreating ? "about" : "browse");
  const archivedCount = channels.filter((c) => c.archivedAt).length;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, "");
    return channels
      .filter((c) => (tab === "archived" ? !!c.archivedAt : !c.archivedAt && (tab === "joined" ? c.joined : true)))
      .filter((c) => !needle || c.name.includes(needle) || c.topic.toLowerCase().includes(needle))
      .sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name));
  }, [channels, q, tab]);
  const name = slug(q.replace(/^#/, ""));
  const exists = channels.some((c) => c.name === name);

  // a dialog opened from the sidebar belongs to the page it was opened on: going elsewhere (a link, the back button) closes it
  useEffect(() => {
    window.addEventListener("hashchange", onClose);
    return () => window.removeEventListener("hashchange", onClose);
  }, [onClose]);

  async function open(id: string, joined: boolean) {
    if (!joined) await api("POST", `/api/channels/${id}/join`);
    await refreshChannels();
    onClose();
    go({ view: "chat", channelId: id, threadId: null });
  }

  if (step === "about")
    return (
      <Suspense fallback={null}>
        <NewTeamFlow onClose={onClose} sectionId={sectionId} initialName={name} />
      </Suspense>
    );

  return (
    <Modal title="Add a team" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search or create a team"
            className="pl-9 h-10"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name && !exists) setStep("about");
            }}
          />
        </div>
        <div className="flex gap-4 border-b border-line text-sm" role="tablist">
          {(["all", "joined", ...(archivedCount ? ["archived" as const] : [])] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("pb-2 -mb-px border-b-2", tab === t ? "border-ink text-ink font-medium" : "border-transparent text-muted hover:text-ink")}>
              {t === "all" ? "All teams" : t === "joined" ? "Joined" : `Archived · ${archivedCount}`}
            </button>
          ))}
        </div>

        <button onClick={() => setStep("about")} className="w-full rounded-xl bg-bg hover:bg-hover px-4 h-12 flex items-center gap-3 text-sm font-medium">
          <span className="size-7 rounded-lg bg-panel border border-line grid place-items-center">
            <Plus size={15} />
          </span>
          {name && !exists ? `Create #${name}` : "Create a new team"}
        </button>

        <div className="rounded-xl border border-line divide-y divide-line max-h-[50vh] overflow-y-auto">
          {list.length === 0 && <p className="px-4 py-6 text-sm text-muted text-center">No teams match.</p>}
          {list.map((c) => (
            <button key={c.id} onClick={() => open(c.id, c.joined)} className="w-full text-left px-4 py-3 hover:bg-hover flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium flex items-center gap-1">
                  <ChannelIcon channel={c} /> {c.name}
                  {c.archivedAt && <span className="ml-1 text-[11px] font-normal text-muted rounded bg-chip px-1.5">Archived</span>}
                </div>
                <div className="text-xs text-muted truncate">
                  {c.memberCount} {c.memberCount === 1 ? "member" : "members"}
                  {c.topic && ` · ${c.topic}`}
                </div>
              </div>
              {c.archivedAt ? (
                <span className="text-xs text-muted">Read only</span>
              ) : c.joined ? (
                <span className="text-xs text-muted inline-flex items-center gap-1">
                  <Check size={13} /> Joined
                </span>
              ) : (
                <span className="text-xs font-medium text-accent-text">Join</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Create or rename a sidebar section. */
export function SectionDialog({ section, onClose }: { section?: Section; onClose: () => void }) {
  const [name, setName] = useState(section?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const refresh = useStore((s) => s.refreshSections);
  return (
    <Modal title={section ? "Rename section" : "New section"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            // sections are plain names; an emoji an older version gave one is kept as it was
            if (section) await api("PATCH", `/api/sections/${section.id}`, { name, emoji: section.emoji });
            else await api("POST", "/api/sections", { name, emoji: "" });
            await refresh();
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Launch" required maxLength={40} />
        </Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end">
          <Button variant="primary">{section ? "Save" : "Create section"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// --- channel settings -----------------------------------------------------------------------------

/** Someone in a channel, as GET /api/channels/:id/members returns them. */
export interface ChannelMember {
  kind: "user" | "agent";
  id: string;
  name: string;
  handle: string | null;
  role: string | null;
}

export type ChannelSettingsTab = "about" | "team" | "agents" | "members" | "pins" | "danger";

/** Where to land when no channel is picked: #general, or the first open channel if #general is archived or deleted. */
export function landingChannel(channels: ChannelInfo[]) {
  const open = channels.filter((c) => c.kind === "channel" && !c.archivedAt);
  return open.find((c) => c.name === "general") ?? open.find((c) => c.joined) ?? channels.find((c) => c.kind === "channel" && c.name === "general");
}

/** Back to #general (after leaving or deleting the channel you were in). */
export function toGeneral() {
  go({ view: "chat", channelId: landingChannel(useStore.getState().channels)?.id ?? null, threadId: null });
}

/** Leave a channel; if you were looking at it, go back to #general. */
export async function leaveChannel(channel: ChannelInfo) {
  await api("POST", `/api/channels/${channel.id}/leave`);
  await useStore.getState().refreshChannels();
  if (useStore.getState().activeChannel === channel.id) toGeneral();
}

/** Where each tab of the old settings dialog lives in the team panel now. */
const SHEET_OF: Record<ChannelSettingsTab, TeamSheet> = { about: "details", team: "who", agents: "more", members: "who", pins: "pins", danger: "more" };

/**
 * A team's settings from outside its chat (a sidebar row's menu, "Add agent" in an empty team):
 * the team panel itself, in a sheet. There is no second settings dialog: everything is in the
 * panel's rows.
 */
export function ChannelSettings({ channel: initial, tab = "about", onClose }: { channel: ChannelInfo; tab?: ChannelSettingsTab; onClose: () => void }) {
  // follow the live channel, so pins and members update while the sheet is open
  const channel = useStore((s) => s.channels.find((c) => c.id === initial.id)) ?? initial;
  return (
    <Modal title={channel.name} label={`${channel.name} settings`} headerless onClose={onClose} className="sm:max-w-[360px]!" contentClassName="p-0!">
      <div className="flex h-[min(640px,84vh)] flex-col">
        <TeamPanel channel={channel} sheet={SHEET_OF[tab]} onClose={onClose} />
      </div>
    </Modal>
  );
}

/** Who is on a team: add an agent or a person by name, take one off, and leave it yourself. */
export function ChannelMembers({ channel, canManage, onClose }: { channel: ChannelInfo; canManage: boolean; onClose: () => void }) {
  const me = useStore((s) => s.me);
  const people = useStore((s) => s.members);
  const agents = useStore((s) => s.agents);
  const [members, setMembers] = useState<ChannelMember[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<ChannelMember[]>("GET", `/api/channels/${channel.id}/members`)
      .then((m) => live && setMembers(m))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
    // the count changes when anyone joins or leaves; reload then too
  }, [channel.id, channel.memberCount]);

  const inChannel = new Set((members ?? []).map((m) => `${m.kind}:${m.id}`));
  const needle = q.trim().toLowerCase().replace(/^@/, "");
  const candidates: ChannelMember[] = needle
    ? [
        ...people.map((p) => ({ kind: "user" as const, id: p.id, name: p.name, handle: null, role: p.role })),
        ...agents.map((a) => ({ kind: "agent" as const, id: a.id, name: a.name, handle: a.handle, role: null })),
      ]
        .filter((c) => !inChannel.has(`${c.kind}:${c.id}`))
        .filter((c) => c.name.toLowerCase().includes(needle) || c.handle?.includes(needle))
        .slice(0, 8)
    : [];

  async function change(method: "PUT" | "DELETE", m: Pick<ChannelMember, "kind" | "id">) {
    setError(null);
    setBusy(`${m.kind}:${m.id}`);
    try {
      setMembers(await api<ChannelMember[]>(method, `/api/channels/${channel.id}/members/${m.kind}/${m.id}`));
      if (method === "PUT") setQ("");
      if (m.kind === "user" && m.id === me?.user.id) await useStore.getState().refreshChannels();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const peopleIn = (members ?? []).filter((m) => m.kind === "user");
  const agentsIn = (members ?? []).filter((m) => m.kind === "agent");
  const agentById = (id: string) => agents.find((a) => a.id === id);
  const nodes = channel.settings.team?.nodes ?? [];

  return (
    <div className="space-y-3">
      {canManage && !channel.archivedAt && (
        <div className="relative">
          <UserPlus size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Add an agent or a person"
            className="pl-9 h-10"
            aria-label="Add an agent or a person"
            onKeyDown={(e) => {
              if (e.key === "Enter" && candidates[0]) {
                e.preventDefault();
                change("PUT", candidates[0]);
              }
            }}
          />
          {needle && (
            <div className="absolute z-10 left-0 right-0 top-full mt-1 rounded-xl border border-line bg-panel shadow-panel p-1 max-h-64 overflow-y-auto">
              {candidates.length === 0 && <p className="px-3 py-2 text-sm text-muted">None</p>}
              {candidates.map((c) => (
                <button key={`${c.kind}:${c.id}`} onClick={() => change("PUT", c)} disabled={!!busy} className="w-full px-2 h-10 rounded-lg flex items-center gap-2.5 text-sm text-left hover:bg-hover">
                  {c.kind === "agent" ? <AgentAvatar agent={agentById(c.id)} size={24} /> : <UserAvatar name={c.name} size={24} />}
                  <span className="min-w-0 truncate font-medium">{c.name}</span>
                  <Plus size={14} className="ml-auto shrink-0 text-faint" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
      {!!members?.length && (
        <div className="overflow-hidden rounded-[12px] bg-card divide-y divide-line">
          {[...agentsIn, ...peopleIn].map((m) => {
            const isMe = m.kind === "user" && m.id === me?.user.id;
            const node = m.kind === "agent" ? nodes.find((n) => n.agentId === m.id) : undefined;
            const sub = m.kind === "agent" ? (node?.lead ? "Leads" : (node?.role ?? `@${m.handle}`)) : m.role;
            const who = (
              <>
                {m.kind === "agent" ? <AgentAvatar agent={agentById(m.id) ?? { name: m.name, handle: m.handle ?? undefined, harness: "custom" }} size={28} interactive={false} /> : <UserAvatar name={m.name} size={28} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    {m.name}
                    {isMe && <span className="font-normal text-muted"> (you)</span>}
                  </span>
                  {sub && <span className="block truncate text-[12px] text-muted">{sub}</span>}
                </span>
              </>
            );
            return (
              <div key={`${m.kind}:${m.id}`} className="flex min-h-[50px] items-center gap-1 pl-3.5 pr-2">
                {m.kind === "agent" ? (
                  <button type="button" onClick={() => (onClose(), go({ view: "agents", agentId: m.id, tab: "overview" }))} className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left">
                    {who}
                  </button>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-3 py-1.5">{who}</div>
                )}
                {isMe && channel.name !== "general" ? (
                  <Button
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={async () => {
                      await leaveChannel(channel);
                      onClose();
                    }}
                  >
                    Leave
                  </Button>
                ) : (
                  canManage && (
                    <button onClick={() => change("DELETE", m)} disabled={busy === `${m.kind}:${m.id}`} className="grid size-8 shrink-0 place-items-center rounded-[8px] text-faint hover:bg-hover hover:text-bad" aria-label={`Remove ${m.name} from ${channel.name}`}>
                      <X size={15} />
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Who's working on the chart right now, and where: "Working" or "In a thread". */
export function useTeamWork(channelId: string): Record<string, string> {
  const live = useStore(liveShape);
  const out: Record<string, string> = {};
  for (const r of Object.values(live)) if (r.channelId === channelId) out[r.agentId] = r.threadId ? "Working in a thread" : "Working";
  return out;
}

/**
 * The older kind of team, a plain chart of who hands work to whom: its leads, its arrows and each
 * agent's role. Teams made by picking agents by name start as one. (A team that runs on steps is
 * edited in the builder instead.) Saving adds everyone on the chart to the team.
 */
export function PlainChartDialog({ channel, onClose }: { channel: ChannelInfo; onClose: () => void }) {
  const names = useNames();
  const agents = useStore((s) => s.agents);
  const refreshChannels = useStore((s) => s.refreshChannels);
  const working = useTeamWork(channel.id);
  const saved = liveTeam(channel.settings.team, agents) ?? EMPTY_TEAM;
  const [team, setTeam] = useState<ChannelTeam>(saved);
  const [newAgent, setNewAgent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(team) !== JSON.stringify(saved);
  const problem = team.nodes.length ? teamProblem(team) : null;
  const setNode = (agentId: string, patch: { role?: string; roleNotes?: string }) => setTeam({ ...team, nodes: team.nodes.map((n) => (n.agentId === agentId ? { ...n, ...patch } : n)) });
  const save = async (next: ChannelTeam | null) => {
    setError(null);
    setSaving(true);
    try {
      await api("PATCH", `/api/channels/${channel.id}`, { settings: { team: next } });
      await refreshChannels();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  if (newAgent)
    return (
      <Suspense fallback={null}>
        <NewAgentForTeam
          onClose={() => setNewAgent(false)}
          onCreated={(a) => {
            setTeam((t) => addToTeam(t, a.id));
            setNewAgent(false);
          }}
        />
      </Suspense>
    );
  return (
    <Modal title={channel.name} label={`Who hands work to whom in ${channel.name}`} onClose={onClose} className="sm:max-w-5xl!">
      <div className="space-y-4">
        <TeamChart team={team} onChange={setTeam} working={working} onCreateAgent={() => setNewAgent(true)} />
        {team.nodes.length > 0 && (
          <div className="space-y-2" aria-label="Roles">
            {team.nodes.map((n) => {
              const a = names.agent(n.agentId);
              if (!a) return null;
              return (
                <div key={n.agentId} className="grid sm:grid-cols-[10rem_1fr] gap-2 items-start">
                  <span className="flex items-center gap-2 min-w-0 h-9 text-sm">
                    <AgentAvatar agent={a} size={22} badge={false} interactive={false} /> <span className="truncate">{a.name}</span>
                  </span>
                  <div className="space-y-1.5">
                    <Input value={n.role ?? ""} onChange={(e) => setNode(n.agentId, { role: e.target.value })} placeholder="Role, e.g. Backend" aria-label={`${a.name}'s role`} maxLength={60} />
                    {(n.role || n.roleNotes) && <Textarea rows={2} value={n.roleNotes ?? ""} onChange={(e) => setNode(n.agentId, { roleNotes: e.target.value })} placeholder="What it owns" aria-label={`What ${a.name}'s role owns`} maxLength={4000} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {saved.nodes.length > 0 ? (
            <Button variant="ghost" disabled={saving} onClick={() => void save(null)} title="Agents answer only when someone @mentions them">
              Remove chart
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" disabled={!changed || !!problem || !team.nodes.length || saving} onClick={() => void save(team)} title={problem ?? undefined}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface PinRow {
  message: import("@bubble-ai/core").Message;
  pinnedBy: import("@bubble-ai/core").Actor;
  pinnedAt: string;
}

/** The messages pinned in a channel, newest pin first, each one a way back to where it was said. */
export function ChannelPins({ channel, onClose }: { channel: ChannelInfo; onClose: () => void }) {
  const names = useNames();
  const canPin = useStore((s) => s.me?.role !== "guest") && !channel.archivedAt;
  const [pins, setPins] = useState<PinRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = channel.pinnedIds.join();
  useEffect(() => {
    let live = true;
    api<PinRow[]>("GET", `/api/channels/${channel.id}/pins`)
      .then((p) => live && setPins(p))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [channel.id, key]);
  const who = (a: import("@bubble-ai/core").Actor) => (a.kind === "agent" ? names.agent(a.id)?.name : names.member(a.id)?.name) ?? "Someone";
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!pins) return null;
  if (!pins.length) return <p className="px-1 py-2 text-[13px] text-muted">Nothing pinned</p>;
  return (
    <div className="overflow-hidden rounded-[12px] bg-card divide-y divide-line">
      {pins.map((p) => (
        <div key={p.message.id} className="px-3 py-2.5 flex gap-3 items-start">
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              onClose();
              go({ view: "chat", channelId: channel.id, threadId: p.message.threadId });
            }}
          >
            <div className="text-xs text-muted">
              <span className="font-medium text-ink">{who(p.message.author)}</span> · pinned by {who(p.pinnedBy)}
            </div>
            <div className="text-sm line-clamp-3 whitespace-pre-wrap">{p.message.body || "(an attachment)"}</div>
          </button>
          {canPin && (
            <button onClick={() => api("DELETE", `/api/messages/${p.message.id}/pin`).catch((e) => setError((e as Error).message))} className="size-8 shrink-0 rounded-lg grid place-items-center text-muted hover:text-bad hover:bg-hover" aria-label="Unpin" title="Unpin">
              <X size={15} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
