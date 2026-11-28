import { useEffect, useState, type ReactNode } from "react";
import { Bell, Blocks, Building2, ChevronRight, Compass, Download, Info, KeyRound, LayoutGrid, LifeBuoy, Monitor, Moon, ShieldCheck, Smartphone, Sparkles, UserRound, X } from "lucide-react";
import "../../round11-settings.css";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { go, href } from "../../router.ts";
import { useAppearance, type ModeChoice } from "../../theme.ts";
import { useFeatures } from "../../features.ts";
import { useDevices } from "../../devices.ts";
import { androidPush } from "../../push-android.ts";
import { enableNotifications, permission, setNotifyPrefs, useNotifyPrefs } from "../../notifications.ts";
import { initialsOf } from "../../components/Rail.tsx";
import { isOn, useConnectors } from "../../components/ConnectParts.tsx";
import { BubbleIcon } from "../../components/icons.tsx";
import { Menu, cx } from "../../components/ui.tsx";
import { OrgList, useOrgs } from "../../components/OrgSwitcher.tsx";
import { startTour } from "../../components/tour/tourRun.ts";
import { Toggle } from "./parts.tsx";
import { SignOutButton } from "./signout.tsx";
import { FIVE_LABEL, FIVE_ROUTE, fivePages, type Five } from "./map.ts";

const IC = { size: 19, strokeWidth: 1.8 };

/** Each settings page's line icon. */
export const FIVE_ICON: Record<Five, ReactNode> = {
  you: <UserRound {...IC} />,
  agents: <BubbleIcon {...IC} />,
  computers: <Monitor {...IC} />,
  privacy: <ShieldCheck {...IC} />,
  about: <Info {...IC} />,
  learn: <Compass {...IC} />,
  mods: <Blocks {...IC} />,
};

/** The settings address of Import memory (its sheet on the Privacy page). */
export const IMPORT_MEMORY_HREF = href({ view: "settings", page: "memory", item: "import" });

interface Usage {
  totals: { tokens: number };
  background: { dailyTokens: number | null };
}

/** This week's tokens against the weekly share of the daily limit; null while loading or for guests. */
function useWeekUsage(on: boolean): { pct: number | null; tokens: number } | null {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    api<Usage>("GET", "/api/usage?range=7d").then((x) => live && setU(x), () => {});
    return () => {
      live = false;
    };
  }, [on]);
  if (!u) return null;
  const cap = u.background.dailyTokens ? u.background.dailyTokens * 7 : null;
  return { tokens: u.totals.tokens, pct: cap ? Math.min(100, Math.round((u.totals.tokens / cap) * 100)) : null };
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function Chevron() {
  return <ChevronRight size={16} className="text-faint" aria-hidden />;
}

function Li({ icon, label, sub, right, to, onClick }: { icon?: ReactNode; label: ReactNode; sub?: string; right?: ReactNode; to?: string; onClick?: () => void }) {
  const inner = (
    <>
      {icon && <span className="r11s-ic grid size-5 place-items-center" aria-hidden>{icon}</span>}
      <span className={cx("min-w-0 flex-1", sub && "py-2")}>
        <span className="block truncate">{label}</span>
        {sub && <span className="r11s-sub block truncate">{sub}</span>}
      </span>
      <span className="r11s-r">
        {right}
        {(to || onClick) && <Chevron />}
      </span>
    </>
  );
  if (to)
    return (
      <a href={to} className="r11s-li">
        {inner}
      </a>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className="r11s-li">
        {inner}
      </button>
    );
  return <div className="r11s-li">{inner}</div>;
}

/** Notifications on this device: one switch; the row's name opens the full page. */
function NotifyRow() {
  const prefs = useNotifyPrefs();
  const [perm, setPerm] = useState(permission());
  const to = href({ view: "settings", page: "notifications" });
  if (androidPush() || perm === "unsupported" || perm === "denied") return <Li icon={<Bell {...IC} />} label="Notifications" to={to} />;
  const on = perm === "granted" && prefs.enabled;
  const change = async (v: boolean) => {
    if (!v) return setNotifyPrefs({ enabled: false });
    const p = perm === "granted" ? perm : await enableNotifications();
    setPerm(p);
    if (p === "granted") setNotifyPrefs({ enabled: true });
  };
  return (
    <div className="r11s-li">
      <a href={to} className="flex min-w-0 flex-1 items-center gap-3 self-stretch outline-none hover:underline-offset-2">
        <span className="r11s-ic grid size-5 place-items-center" aria-hidden>
          <Bell {...IC} />
        </span>
        <span className="truncate">Notifications</span>
      </a>
      <Toggle on={on} onChange={(v) => void change(v)} label="Notifications on this device" />
    </div>
  );
}

const MODES: [ModeChoice, string][] = [
  ["system", "System"],
  ["light", "Light"],
  ["dark", "Dark"],
];

function AppearanceRow() {
  const { mode, setMode } = useAppearance();
  const name = MODES.find(([m]) => m === mode)?.[1] ?? "System";
  return (
    <Menu
      align="right"
      items={MODES.map(([m, label]) => ({ label: m === mode ? `${label}  ✓` : label, onSelect: () => setMode(m) }))}
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" className="r11s-li">
          <span className="r11s-ic grid size-5 place-items-center" aria-hidden>
            <Moon {...IC} />
          </span>
          <span className="flex-1">Appearance</span>
          <span className="r11s-r">{name}</span>
        </button>
      )}
    />
  );
}

/**
 * Settings, one sheet (round 11, board 14): you and this week's usage at the top, then apps, computers
 * and devices, what your agents know and use, notifications and appearance, and further down Help,
 * Mods and every settings page. `search` is the settings search, placed above the pages.
 */
export function SettingsHome({ onClose, search }: { onClose?: () => void; search?: ReactNode }) {
  const me = useStore((s) => s.me)!;
  const guest = me.role === "guest";
  const features = useFeatures();
  const pages = fivePages(guest, features);
  const usage = useWeekUsage(!guest);
  const connectors = useConnectors();
  const devices = useDevices(30_000);
  const { orgs: allOrgs, current } = useOrgs();
  const [orgs, setOrgs] = useState(false);
  const connected = connectors?.filter(isOn).length ?? 0;
  const deviceCount = devices?.filter((d) => d.mine || d.shared).length ?? 0;
  const orgName = current?.name ?? me.workspace.name;
  const elsewhere = allOrgs.some((o) => o.unread && !o.current && o.id !== me.workspace.id);
  const page = (p: Five) => href({ view: "settings", page: FIVE_ROUTE[p] });

  return (
    <div className="r11s mx-auto flex w-full max-w-[520px] flex-col gap-3.5 pb-6">
      {onClose && (
        <div className="flex items-center pt-1">
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-[var(--btn)] outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      )}
      <h1 className="sr-only">Settings</h1>

      <div className="r11s-grp">
        <a href={page("you")} className="r11s-li min-h-[60px]!">
          <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-[var(--btn)] text-[13px] font-semibold" aria-hidden>
            {initialsOf(me.user.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{me.user.name}</span>
            <span className="r11s-sub block truncate">{me.user.email}</span>
          </span>
          <span className="r11s-r">
            <Chevron />
          </span>
        </a>
        {!guest && (
          <a href={href({ view: "settings", page: "usage" })} className="r11s-li flex-col items-stretch! justify-center gap-1.5 py-2.5">
            <span className="flex">
              Usage this week
              <span className="ml-auto text-[14px] text-muted">{usage == null ? "" : usage.pct != null ? `${usage.pct}%` : `${compact(usage.tokens)} tokens`}</span>
            </span>
            <span className="r11s-bar" aria-hidden>
              <span style={{ width: `${usage?.pct ?? 0}%` }} />
            </span>
          </a>
        )}
      </div>

      {!guest && (
        <div className="r11s-grp">
          <Li icon={<LayoutGrid {...IC} />} label="Connect apps" right={connected > 0 ? connected : undefined} to={href({ view: "marketplace" })} />
          <Li icon={<Monitor {...IC} />} label="Computers" to={href({ view: "computers", computerId: null })} />
          <Li icon={<Smartphone {...IC} />} label="Devices" right={deviceCount > 0 ? deviceCount : undefined} to={href({ view: "settings", page: "devices" })} />
        </div>
      )}

      {!guest && (
        <div>
          <div className="r11s-sec">Your agents</div>
          <div className="r11s-grp">
            <Li icon={<Download {...IC} />} label="Import memory" sub="Bring what ChatGPT knows about you" to={IMPORT_MEMORY_HREF} />
            <Li icon={<KeyRound {...IC} />} label="Passwords" sub="From your password manager" to={href({ view: "settings", page: "logins" })} />
          </div>
        </div>
      )}

      <div className="r11s-grp">
        <NotifyRow />
        <AppearanceRow />
      </div>

      <div className="r11s-grp">
        <Li icon={<LifeBuoy {...IC} />} label="Help" to={href({ view: "help" })} />
        {!guest && <Li icon={<Blocks {...IC} />} label="Mods" to={page("mods")} />}
        {!guest && <Li icon={<Compass {...IC} />} label="Show me around" onClick={() => startTour()} />}
        <Li icon={<Sparkles {...IC} />} label="What's new" to={href({ view: "settings", page: "updates", item: "news" })} />
      </div>

      <div>
        <div className="r11s-sec">All settings</div>
        {search && <div className="mb-2.5">{search}</div>}
        <div className="r11s-grp">
          {pages
            .filter((p) => p !== "mods")
            .map((p) => (
              <Li key={p} icon={FIVE_ICON[p]} label={p === "you" ? "Profile and preferences" : FIVE_LABEL[p]} to={page(p)} />
            ))}
          <Li
            icon={<Building2 {...IC} />}
            label="Workspace"
            right={
              <span className="flex min-w-0 items-center gap-1.5">
                {elsewhere && <span className="size-2 shrink-0 rounded-full bg-badge" role="img" aria-label="New messages in another workspace" />}
                <span className="max-w-[160px] truncate">{orgName}</span>
              </span>
            }
            onClick={() => setOrgs(true)}
          />
        </div>
      </div>

      <SignOutButton icon={false} className="r11s-grp min-h-[48px] w-full text-[15px] font-medium text-bad" />

      {orgs && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 md:items-center" onMouseDown={(e) => e.target === e.currentTarget && setOrgs(false)}>
          <div role="dialog" aria-modal="true" aria-label="Workspaces" className="w-full max-w-[420px] rounded-t-[16px] border border-line bg-panel pb-6 md:rounded-[16px] safe-bottom">
            <div className="flex justify-end p-3.5 pb-0">
              <button type="button" onClick={() => setOrgs(false)} aria-label="Close" className="circle">
                <X size={20} />
              </button>
            </div>
            <OrgList onDone={() => setOrgs(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Go to the settings home from a page inside it. */
export const toSettingsHome = () => go({ view: "settings", page: null });
