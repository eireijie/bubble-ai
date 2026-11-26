import { useContext, useEffect, useState } from "react";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { useDevices } from "../../devices.ts";
import { useConnections } from "../../models.ts";
import { setFeatures, useFeatures } from "../../features.ts";
import { ClockSeg, EnterSwitch, ModeSeg, MotionSwitch, NotifyValue, ProfileRows, SessionsValue, TextSizeSeg, ThemeSwatches, ToolCallsSeg } from "./account.tsx";
import { BackupValue, LeadSelect, RulesValue, askValue, useAgentPolicy, useComputerSettings } from "./workspace.tsx";
import { thinksValue, useAgentDefaults, useDefaultDeviceChoices, type AgentDefaults } from "./defaults.tsx";
import { AwayRow, DevicesRows, McpValue, PickSwitch } from "./devices.tsx";
import { MemoryFolderValue } from "./memory.tsx";
import { VoiceValue } from "./voice.tsx";
import { compact } from "./usage.tsx";
import { SignOutButton } from "./signout.tsx";
import { Select, Toggle } from "./parts.tsx";
import { FiveContext, Group, Note, SRow, Seg } from "./rows.tsx";
import { FEATURE_INFO, type FeatureKey } from "@bubble-ai/core";
import { href } from "../../router.ts";

/**
 * The settings pages but About (about.tsx). Each is its rows in cards, the first untitled, the rest
 * under a small title; nothing is folded away. Which rows are which, their names and their
 * addresses are in map.ts; a row that isn't for this person renders nothing.
 */

// --- You ----------------------------------------------------------------------------------------

function BuddySwitch() {
  const features = useFeatures();
  const owner = useStore((s) => s.me?.role) === "owner";
  return <Toggle on={features.buddy} label="Desk buddy" disabled={!owner} onChange={(v) => void setFeatures({ buddy: v })} />;
}

export function YouFive() {
  return (
    <>
      <ProfileRows />
      <Group>
        <SRow id="appearance">
          <ModeSeg />
        </SRow>
        <SRow id="notifications" value={<NotifyValue />} />
      </Group>
      <Group title="Chat">
        <SRow id="enter">
          <EnterSwitch />
        </SRow>
        <SRow id="clock">
          <ClockSeg />
        </SRow>
        <SRow id="tool-calls">
          <ToolCallsSeg />
        </SRow>
      </Group>
      <Group title="Look">
        <SRow id="theme">
          <ThemeSwatches />
        </SRow>
        <SRow id="text-size">
          <TextSizeSeg />
        </SRow>
        <SRow id="motion">
          <MotionSwitch />
        </SRow>
      </Group>
      <Group title="Extras">
        <SRow id="voice" value={<VoiceValue />} />
        <SRow id="buddy">
          <BuddySwitch />
        </SRow>
      </Group>
      <SignOutButton className="px-1 h-8 text-sm text-muted hover:text-ink" />
    </>
  );
}

// --- Agents -------------------------------------------------------------------------------------

/** How many AI accounts are connected. */
function AccountsValue() {
  const { connections } = useConnections();
  const n = (connections ?? []).filter((c) => c.mine).length;
  return <>{connections === null ? "" : n === 0 ? "None" : `${n} connected`}</>;
}

/** The daily limit for work agents do on their own. */
function UsageValue() {
  const [limit, setLimit] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    api<{ background: { dailyTokens: number | null } }>("GET", "/api/usage?range=today").then((u) => setLimit(u.background.dailyTokens), () => {});
  }, []);
  return <>{limit === undefined ? "" : limit === null ? "No limit" : `${compact(limit)} a day`}</>;
}

function LoginsValue() {
  const [source, setSource] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ source: unknown }>("GET", "/api/logins").then((v) => setSource(!!v.source), () => {});
  }, []);
  return <>{source === null ? "" : source ? "1Password" : "Not connected"}</>;
}

/** How many AI tools are installed across your devices. */
function ToolsValue() {
  const devices = useDevices(60_000);
  if (!devices) return null;
  const n = new Set(devices.filter((d) => d.mine).flatMap((d) => (d.harnesses ?? []).map((h) => h.id))).size;
  return <>{n === 0 ? "None" : `${n} installed`}</>;
}

const numbers = (list: number[]) =>
  list.map((n) => (
    <option key={n} value={n}>
      {n}
    </option>
  ));

export function AgentsFive() {
  const { p, error, save, isOwner } = useAgentPolicy();
  const defaults = useAgentDefaults();
  const off = !isOwner || !p;
  const makers = !p?.leadsCreateAgents ? "off" : p.subAgents ? "sub" : "leads";
  return (
    <>
      <Group>
        <SRow id="thinks" value={thinksValue(defaults.saved)} />
        <SRow id="access">
          <Seg
            label="New agents can"
            value={p?.defaultAccess ?? "edit"}
            disabled={off}
            onChange={(v) => void save({ defaultAccess: v })}
            options={[
              ["read-only", "Read"],
              ["edit", "Edit"],
              ["full", "Full"],
            ]}
          />
        </SRow>
        <SRow id="asks" value={askValue(p)} />
        <SRow id="learn">
          <Toggle label="Learn skills on their own" on={p?.learnSkills ?? true} disabled={off} onChange={(v) => void save({ learnSkills: v })} />
        </SRow>
        <SRow id="usage" value={<UsageValue />} />
      </Group>
      {error && <Note bad>{error}</Note>}
      <Group title="AI, apps and skills">
        <SRow id="accounts" value={<AccountsValue />} />
        <SRow id="tools" value={<ToolsValue />} />
        <SRow id="skills" />
        <SRow id="apps" />
        <SRow id="logins" value={<LoginsValue />} />
        <SRow id="outside" value={<McpValue />} />
      </Group>
      <Group title="Teamwork and limits">
        <SRow id="lead">
          <LeadSelect />
        </SRow>
        <SRow id="makers">
          <Select label="Agents making agents" value={makers} disabled={off} onChange={(v) => void save(v === "off" ? { leadsCreateAgents: false } : { leadsCreateAgents: true, subAgents: v === "sub" })}>
            <option value="off">Off</option>
            <option value="leads">Leads</option>
            <option value="sub">Leads and their agents</option>
          </Select>
        </SRow>
        <SRow id="made-max">
          <Select label="Most agents made by agents" value={String(p?.maxAgentMade ?? 10)} disabled={off || !p?.leadsCreateAgents} onChange={(v) => void save({ maxAgentMade: Number(v) })}>
            {numbers([3, 5, 10, 20, 50])}
          </Select>
        </SRow>
        <SRow id="hops">
          <Select label="Hand-offs in a row" value={String(p?.maxHops ?? 6)} disabled={off} onChange={(v) => void save({ maxHops: Number(v) })}>
            {numbers([2, 3, 4, 6, 8, 10, 15, 20, 30])}
          </Select>
        </SRow>
        <SRow id="runs">
          <Select label="Agent runs per team per minute" value={String(p?.maxRunsPerMinute ?? 40)} disabled={off} onChange={(v) => void save({ maxRunsPerMinute: Number(v) })}>
            {numbers([5, 10, 20, 40, 60, 100, 200])}
          </Select>
        </SRow>
      </Group>
    </>
  );
}

// --- Mods ---------------------------------------------------------------------------------------

/** A mod's switch; only owners change mods. */
function ModSwitch({ mod, label }: { mod: FeatureKey; label: string }) {
  const features = useFeatures();
  const owner = useStore((s) => s.me?.role) === "owner";
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <span className="text-xs text-bad">{error}</span>}
      <Toggle on={features[mod]} label={label} disabled={!owner} onChange={(v) => void setFeatures({ [mod]: v }).then(() => setError(null), (e) => setError((e as Error).message))} />
    </>
  );
}

/**
 * Every mod, one switch each: what agents do on their own first (on by default), then the extras.
 * Storage and Apple open their own settings, where they're turned on too.
 */
export function ModsFive() {
  const features = useFeatures();
  const owner = useStore((s) => s.me?.role) === "owner";
  const sw = (id: string, mod: FeatureKey) => (
    <SRow id={id}>
      <ModSwitch mod={mod} label={FEATURE_INFO[mod].name} />
    </SRow>
  );
  return (
    <>
      <Group title="Agents on their own">
        {sw("mod-background", "background")}
        {sw("mod-routines", "routines")}
        {sw("mod-teach", "teach")}
      </Group>
      <Group title="Extras">
        <SRow id="mod-tasks">
          {features.tasks && (
            <a href={href({ view: "tasks" })} className="text-sm text-muted hover:text-ink">
              Open
            </a>
          )}
          <ModSwitch mod="tasks" label={FEATURE_INFO.tasks.name} />
        </SRow>
        <SRow id="storage" value={features.storage ? "On" : "Off"} />
        <SRow id="apple" value={features.apple ? "On" : "Off"} />
        {sw("mod-invite", "invite")}
        {sw("mod-remote", "remoteDesktop")}
        {sw("mod-code", "code")}
        {sw("mod-buddy", "buddy")}
      </Group>
      {!owner && <Note>Only owners can change mods.</Note>}
    </>
  );
}

// --- Computers ----------------------------------------------------------------------------------

export function ComputersFive() {
  const five = useContext(FiveContext);
  const { s, error, put, isOwner } = useComputerSettings();
  const d = useAgentDefaults();
  const { choices, noneCanRun } = useDefaultDeviceChoices(d.saved?.computer);
  const off = !isOwner || !s;
  const noDefaults = !d.isOwner || !d.saved || d.busy;
  const setDefault = (patch: Partial<AgentDefaults>) => d.saved && void d.save({ ...d.saved, ...patch });
  return (
    <>
      <DevicesRows />
      <Group>
        <AwayRow expanded={five.landed === "away"} />
        <SRow id="phone" />
        <SRow id="control">
          <Select label="Give control back after" value={String(s?.defaults.controlIdleMinutes ?? 10)} disabled={off} onChange={(v) => void put({ controlIdleMinutes: Number(v) })}>
            {[5, 10, 15, 30, 60, 120].map((n) => (
              <option key={n} value={n}>
                {n < 60 ? `${n} minutes` : `${n / 60} hour${n === 60 ? "" : "s"}`}
              </option>
            ))}
          </Select>
        </SRow>
        <SRow id="vm-size">
          <Seg
            label="Size of new computers"
            value={s?.defaults.vmSize ?? "medium"}
            disabled={off}
            onChange={(vmSize) => void put({ vmSize })}
            options={[
              ["small", "Small"],
              ["medium", "Medium"],
              ["large", "Large"],
            ]}
          />
        </SRow>
      </Group>
      {error && <Note bad>{error}</Note>}
      <Group title="New agents">
        <SRow id="works-on">
          <Select label="New agents work on" value={d.saved?.computer ?? "device"} disabled={noDefaults} onChange={(v) => setDefault({ computer: v as AgentDefaults["computer"] })}>
            <option value="device">Their device directly</option>
            <option value="shared">The shared computer</option>
            <option value="own-vm">Their own computer</option>
            <option value="none">No computer</option>
          </Select>
        </SRow>
        <SRow id="works-device">
          <Select label="Device for new agents" value={d.saved?.nodeId ?? ""} disabled={noDefaults} onChange={(v) => setDefault({ nodeId: v || null })} className="max-w-60">
            <option value="">Automatic</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.online ? "" : " (offline)"}
              </option>
            ))}
            {d.saved?.nodeId && !choices.some((c) => c.id === d.saved!.nodeId) && <option value={d.saved.nodeId}>A device you can't use</option>}
          </Select>
        </SRow>
        <SRow id="pick">
          <PickSwitch />
        </SRow>
        <SRow id="cloud" value={!s ? "" : s.orgo.configured ? "Connected" : "Not connected"} />
      </Group>
      {noneCanRun && (five.landed === "works-on" || five.landed === "works-device") && <Note>None of your devices can run a computer for an agent yet.</Note>}
      {d.error && <Note bad>{d.error}</Note>}
    </>
  );
}

// --- Privacy and data ---------------------------------------------------------------------------

export function PrivacyFive() {
  const me = useStore((s) => s.me)!;
  const people = useStore((s) => s.members.length);
  return (
    <>
      <Group>
        <SRow id="password" />
        <SRow id="sessions" value={<SessionsValue />} />
        <SRow id="people" value={`${people} ${people === 1 ? "person" : "people"}`} />
      </Group>
      <Group>
        <SRow id="memory-access" value={<RulesValue />} />
        <SRow id="memory-folder" value={<MemoryFolderValue />} />
        <SRow id="backup" value={<BackupValue />} />
      </Group>
      <Group title="Workspace">
        <SRow id="workspace" value={me.workspace.name} />
        <SRow id="changes" />
        <SRow id="obsidian" />
        <SRow id="import" />
      </Group>
    </>
  );
}
