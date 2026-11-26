import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Blocks, Check, Clock, Eye, LayoutGrid, Smartphone, UserRound, Wifi, X } from "lucide-react";
import { FEATURE_INFO, FEATURE_PRESETS, FEATURE_KEYS, type Agent, type FeatureKey, type Routine } from "@wisp/core";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { go } from "../router.ts";
import { useAccess } from "../access.ts";
import { awayEnabled } from "../components/Access.tsx";
import { setFeatures, useFeatures } from "../features.ts";
import { serverAddress, setReadyItem, useReadyChecklist, type ReadyItem } from "../onboarding.ts";
import { morningPlan, turnOnMorningPlan } from "../onboardingSetup.ts";
import { cx } from "../components/ui.tsx";
import { KnowSheet, PhoneSheet } from "../components/onboarding/AskSheets.tsx";
import { ASK_OPENS } from "../components/onboarding/FirstChat.tsx";

/**
 * Setup (#/here[/<agentId>], "Finish setup" in the account menu): the four things the first run no
 * longer asks, each one line and one button, then what setup turned on, each with Undo (routines
 * and watches pause, mods turn off).
 */

interface Row {
  id: string;
  icon: ReactNode;
  title: string;
  sub?: string;
  /** Undo/Redo: `off` is the undone state */
  toggle: { off: boolean; run: (off: boolean) => Promise<void> };
}

type WatchRow = { id: string; label: string; agentIds: string[]; paused: boolean };

const ICON = { size: 17, strokeWidth: 1.7, "aria-hidden": true } as const;
const TODO_ICON: Record<ReadyItem, ReactNode> = { phone: <Smartphone {...ICON} />, apps: <LayoutGrid {...ICON} />, away: <Wifi {...ICON} />, know: <UserRound {...ICON} /> };
const pill = "h-8 shrink-0 rounded-full border border-line2 px-3.5 text-[13px] text-ink hover:bg-hover transition-transform active:scale-[.97] motion-reduce:transition-none disabled:opacity-60";

export function cronLine(schedule: string | null): string {
  if (!schedule) return "When you run it";
  const m = schedule.trim().split(/\s+/);
  if (m.length === 5 && /^\d+$/.test(m[0]) && /^\d+$/.test(m[1]) && m[2] === "*" && m[3] === "*") {
    const t = `${m[1].padStart(2, "0")}:${m[0].padStart(2, "0")}`;
    if (m[4] === "*") return `Every day at ${t}`;
    if (m[4] === "1-5") return `Weekdays at ${t}`;
  }
  return "On a schedule";
}

export function HereView({ agentId }: { agentId?: string | null }) {
  const me = useStore((s) => s.me)!;
  const agent = useSetupAgent(agentId);
  const features = useFeatures();
  const ready = useReadyChecklist();
  const owner = me.role === "owner";
  const guest = me.role === "guest";

  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [watches, setWatches] = useState<WatchRow[] | null>(null);
  // mods that were on when the page opened: undoing one keeps its row, as "Undone"
  const [mods] = useState<FeatureKey[]>(() => FEATURE_KEYS.filter((k) => features[k] && !FEATURE_PRESETS.simple[k]));

  const load = useCallback(() => {
    if (!agent) return;
    api<Routine[]>("GET", `/api/routines?agent=${agent.id}`).then(setRoutines, () => setRoutines([]));
    api<{ watches: WatchRow[] }>("GET", "/api/watches").then((r) => setWatches(r.watches.filter((w) => w.agentIds.includes(agent.id))), () => setWatches([]));
  }, [agent]);
  useEffect(load, [load]);
  // opening this page is enough for it to stay in the account menu while anything is left
  useEffect(() => {
    if (ready.workspaceId && !ready.started) setReadyItem(ready.workspaceId, "started", true);
  }, [ready.workspaceId, ready.started]);

  const rows: Row[] = [];
  for (const r of routines ?? []) {
    rows.push({
      id: `r:${r.id}`,
      icon: <Clock {...ICON} />,
      title: r.name,
      sub: cronLine(r.schedule),
      toggle: {
        off: !r.enabled,
        run: async (off) => {
          await api("PATCH", `/api/routines/${r.id}`, { enabled: !off });
          setRoutines((list) => list?.map((x) => (x.id === r.id ? { ...x, enabled: !off } : x)) ?? null);
        },
      },
    });
  }
  for (const w of watches ?? []) {
    rows.push({
      id: `w:${w.id}`,
      icon: <Eye {...ICON} />,
      title: `Watching ${w.label}`,
      toggle: {
        off: w.paused,
        run: async (off) => {
          await api("PATCH", `/api/watches/${w.id}`, { paused: off });
          setWatches((list) => list?.map((x) => (x.id === w.id ? { ...x, paused: off } : x)) ?? null);
        },
      },
    });
  }
  if (owner) for (const k of mods) rows.push({ id: `m:${k}`, icon: <Blocks {...ICON} />, title: `${FEATURE_INFO[k].name} mod`, toggle: { off: !features[k], run: async (off: boolean) => void (await setFeatures({ [k]: !off })) } });

  // the one thing setup offers to turn on: a morning plan, when there is something to build it from
  const plan = agent && !guest && routines && !routines.some((r) => r.name === "Morning plan") ? morningPlan(me.workspace.id, me.user.name, agent.settings.role ?? "") : null;

  return (
    <div className="flex-1 overflow-y-auto bg-panel">
      <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-8 md:pt-12">
        <h1 className="text-[24px] leading-[30px] font-[650] tracking-[-0.015em] text-ink">Setup</h1>
        <div className="mt-5">
          <FinishSetupList agent={agent} />
        </div>

        {(rows.length > 0 || plan) && (
          <>
            <h2 className="mt-8 px-1 text-[13px] font-medium text-muted">Turned on</h2>
            <ul className="mt-2 overflow-hidden rounded-[14px] bg-card divide-y divide-line" aria-live="polite">
              {rows.map((r) => {
                const off = r.toggle.off;
                return (
                  <li key={r.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                    <span className={cx("grid size-9 shrink-0 place-items-center rounded-full bg-chip text-ink", off && "opacity-60")}>{r.icon}</span>
                    <div className={cx("min-w-0 flex-1", off && "opacity-60")}>
                      <div className="truncate text-[14px] font-medium text-ink">{r.title}</div>
                      {(off || r.sub) && <div className="text-[13px] leading-5 text-muted">{off ? "Undone" : r.sub}</div>}
                    </div>
                    <UndoButton off={off} run={r.toggle.run} />
                  </li>
                );
              })}
              {plan && agent && (
                <li className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-chip text-ink opacity-60">
                    <Clock {...ICON} />
                  </span>
                  <div className="min-w-0 flex-1 opacity-60">
                    <div className="truncate text-[14px] font-medium text-ink">{plan.name}</div>
                    <div className="text-[13px] leading-5 text-muted">{cronLine(plan.schedule)}</div>
                  </div>
                  <AskButton label="Turn on" run={async () => void ((await turnOnMorningPlan(me.workspace.id, agent.id, me.user.name, agent.settings.role ?? "")) && load())} />
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/** The agent setup made last (the person's own), else the first. */
function useSetupAgent(agentId?: string | null): Agent | undefined {
  const me = useStore((s) => s.me)!;
  const agents = useStore((s) => s.agents);
  return useMemo(() => {
    if (agentId) return agents.find((a) => a.id === agentId);
    const mine = agents.filter((a) => a.settings.setup?.userId === me.user.id);
    return mine.sort((a, b) => Date.parse(b.settings.setup!.startedAt) - Date.parse(a.settings.setup!.startedAt))[0] ?? agents[0];
  }, [agentId, agents, me.user.id]);
}

/**
 * What the first run no longer asks (phone, apps, away from home, getting to know you), each one
 * line and one button. It lives in Settings › Learn Wisp, and at the top of this page.
 */
export function FinishSetupList({ agent: given }: { agent?: Agent }) {
  const me = useStore((s) => s.me)!;
  const fallback = useSetupAgent();
  const agent = given ?? fallback;
  const ready = useReadyChecklist();
  const access = useAccess();
  const [sheet, setSheet] = useState<"phone" | "know" | null>(null);
  const [copied, setCopied] = useState(false);
  const open = (id: ReadyItem) => {
    const to = ASK_OPENS[id];
    setReadyItem(ready.workspaceId, id, true);
    if (typeof to === "string") setSheet(to);
    else go(to);
  };
  // away from home: once it is on, the row is the address your devices connect to, with Copy
  const away = !!access && awayEnabled(access);
  const address = serverAddress(access)?.url ?? null;
  const copy = () => {
    if (!address) return;
    void navigator.clipboard?.writeText(address);
    setCopied(true);
  };
  if (me.role === "guest") return null;
  return (
    <>
      <ul className="overflow-hidden rounded-[14px] bg-card divide-y divide-line" aria-label="To finish">
        {ready.items.map((t) => {
          const on = t.id === "away" && away;
          return (
            <li key={t.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-chip text-ink">{TODO_ICON[t.id]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-[14px] font-medium text-ink">{t.label}</span>
                  {(t.done || on) && <Check size={14} strokeWidth={2.4} className="shrink-0 text-ok" aria-label="Done" />}
                </div>
                {t.id === "away" && address && <div className="truncate font-mono text-[12px] leading-5 text-muted">{address}</div>}
              </div>
              {on ? (
                <button type="button" className={pill} onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              ) : (
                <button type="button" className={pill} onClick={() => open(t.id)}>
                  {t.button}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {sheet === "phone" && <PhoneSheet onClose={() => setSheet(null)} />}
      {sheet === "know" && agent && <KnowSheet agent={agent} workspaceId={me.workspace.id} onClose={() => setSheet(null)} />}
    </>
  );
}

/** A button that runs something and shows a cross when it failed. */
function AskButton({ label, run }: { label: string; run: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      title={error ? "That didn't work. Try again." : undefined}
      onClick={async () => {
        setBusy(true);
        setError(false);
        try {
          await run();
        } catch {
          setError(true);
        } finally {
          setBusy(false);
        }
      }}
      className={cx(pill, error && "border-bad text-bad")}
    >
      {error ? <X size={13} aria-label="Failed" /> : label}
    </button>
  );
}

function UndoButton({ off, run }: { off: boolean; run: (off: boolean) => Promise<void> }) {
  return <AskButton label={off ? "Redo" : "Undo"} run={() => run(!off)} />;
}

/** "GitHub", "Messages and Calendar", "GitHub, Slack and Notion" */
export function listOf(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
