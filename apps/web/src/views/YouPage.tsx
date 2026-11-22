import { useEffect, useState, type ReactNode } from "react";
import { Blocks, BookOpen, Bot, Building2, ChevronLeft, Cpu, Ghost, LayoutGrid, LifeBuoy, ListTodo, Palette, Bell, Settings, SquareTerminal, ChevronRight, X } from "lucide-react";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { go, href, type Route } from "../router.ts";
import { THEMES, useAppearance } from "../theme.ts";
import { useFeatures } from "../features.ts";
import { initialsOf, useMoreItems } from "../components/Rail.tsx";
import { ComputersIcon } from "../components/icons.tsx";
import { OrgList, useOrgs } from "../components/OrgSwitcher.tsx";
import { Toggle } from "./settings/parts.tsx";
import { SignOutButton } from "./settings/signout.tsx";
import { ASK, type AgentPolicy } from "./settings/workspace.tsx";

const ICON = { size: 20, strokeWidth: 1.8 };

/** One row of the account page's first card. */
export interface YouRow {
  label: string;
  icon: ReactNode;
  to: Route;
}

/**
 * The first card of the account page: the places it always names (`head`), then whatever else the
 * sidebar's More list holds (the mods that are on add their entries there), then `tail`. A place is
 * listed once, under the first label given for it.
 */
export function accountRows(head: YouRow[], more: YouRow[], tail: YouRow[]): YouRow[] {
  const named = new Set([...head, ...tail].map((r) => href(r.to)));
  const seen = new Set<string>();
  return [...head, ...more.filter((r) => !named.has(href(r.to))), ...tail].filter((r) => {
    const key = href(r.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Phones: the account page, behind your picture on the home list. There is no tab bar, so this is
 * where everything that is not a chat lives: computers, adding apps and skills, memory, the mods
 * that are on, settings, the workspace and signing out.
 */
export function YouPage() {
  const me = useStore((s) => s.me)!;
  const { current, orgs: allOrgs } = useOrgs();
  const { theme } = useAppearance();
  const features = useFeatures();
  const [orgs, setOrgs] = useState(false);
  const isGuest = me.role === "guest";
  const isOwner = me.role === "owner";
  const more = useMoreItems(isGuest, ICON.size);
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  useEffect(() => {
    if (!isGuest) api<AgentPolicy>("GET", "/api/settings/agents").then(setPolicy, () => {});
  }, [isGuest]);
  const askOn = !!policy && policy.askBefore.length > 0;
  const setAsk = async (on: boolean) => {
    if (!policy) return;
    setPolicy(await api<AgentPolicy>("PUT", "/api/settings/agents", { askBefore: on ? ASK.map(([k]) => k) : [] }).catch(() => policy));
  };
  const orgName = current?.name ?? me.workspace.name;
  const themeName = THEMES.find((t) => t.id === theme)?.name;
  const elsewhere = allOrgs.some((o) => o.unread && !o.current && o.id !== me.workspace.id);

  const places = accountRows(
    [
      ...(!isGuest ? [{ label: "Computers", icon: <ComputersIcon size={ICON.size} />, to: { view: "computers", computerId: null } as Route }, { label: "Add apps and skills", icon: <LayoutGrid {...ICON} />, to: { view: "marketplace" } as Route }] : []),
      { label: "Memory", icon: <BookOpen {...ICON} />, to: { view: "vault", path: null } },
      { label: "All agents", icon: <Ghost {...ICON} />, to: { view: "agents", agentId: null } },
      ...(!isGuest && features.tasks ? [{ label: "Tasks", icon: <ListTodo {...ICON} />, to: { view: "tasks" } as Route }] : []),
      ...(!isGuest && features.code ? [{ label: "Code", icon: <SquareTerminal {...ICON} />, to: { view: "code" } as Route }] : []),
    ],
    more,
    [...(!isGuest ? [{ label: "Mods", icon: <Blocks {...ICON} />, to: { view: "mods" } as Route }] : []), { label: "Help", icon: <LifeBuoy {...ICON} />, to: { view: "help" } }],
  );

  const row = (icon: ReactNode, label: string, to: string | (() => void), hint?: ReactNode) => {
    const cls = "w-full text-left flex items-center gap-3.5 px-4 min-h-[52px] border-b border-line last:border-0 hover:bg-hover";
    const inner = (
      <>
        <span className="size-5 shrink-0 grid place-items-center text-muted">{icon}</span>
        <span className="flex-1 min-w-0 truncate text-body">{label}</span>
        {hint && <span className="max-w-[45%] truncate text-sm text-muted">{hint}</span>}
        <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
      </>
    );
    return typeof to === "string" ? (
      <a key={label} href={to} className={cls}>
        {inner}
      </a>
    ) : (
      <button key={label} onClick={to} className={cls}>
        {inner}
      </button>
    );
  };
  const card = (children: ReactNode, label?: string) => (
    <nav aria-label={label} className="rounded-[14px] bg-card overflow-hidden">
      {children}
    </nav>
  );

  return (
    <div className="flex-1 overflow-y-auto safe-top">
      <div className="px-4 pt-3 pb-2 space-y-4">
        <header className="flex items-center gap-3">
          <button className="circle shrink-0" onClick={() => go({ view: "chats" })} aria-label="Back">
            <ChevronLeft size={22} aria-hidden />
          </button>
          <a href={href({ view: "settings", page: "profile" })} aria-label={`${me.user.name}, your profile`} className="flex min-w-0 flex-1 items-center gap-3 rounded-[14px] py-1 pr-2">
            <span className="circle shrink-0 font-semibold" style={{ width: 48, height: 48, fontSize: 15 }} aria-hidden>
              {initialsOf(me.user.name)}
            </span>
            <span className="min-w-0 flex-1">
              <h1 className="truncate text-[19px] font-semibold leading-6">{me.user.name}</h1>
              <span className="block truncate text-[13px] text-muted">{orgName}</span>
            </span>
          </a>
        </header>
        {card(places.map((p) => row(p.icon, p.label, href(p.to))), "Your Wisp")}
        {card(
          <>
            {!isGuest && (
              <div className="flex items-center gap-3.5 px-4 min-h-[52px] border-b border-line">
                <span className="size-5 shrink-0 grid place-items-center text-muted">
                  <Bot {...ICON} />
                </span>
                <span className="flex-1 min-w-0 text-body">Ask before risky actions</span>
                <Toggle on={askOn} onChange={setAsk} label="Ask before risky actions" disabled={!isOwner || !policy} />
              </div>
            )}
            {!isGuest && row(<Cpu {...ICON} />, "Agent defaults", href({ view: "settings", page: "agent-defaults" }))}
            {row(<Bell {...ICON} />, "Notifications", href({ view: "settings", page: "notifications" }))}
            {row(<Palette {...ICON} />, "Appearance", href({ view: "settings", page: "appearance" }), themeName)}
            {row(<Settings {...ICON} />, "Settings", href({ view: "settings" }))}
            {row(
              <Building2 {...ICON} />,
              "Workspace",
              () => setOrgs(true),
              <span className="flex items-center gap-1.5">
                {elsewhere && <span className="size-2 shrink-0 rounded-full bg-badge" role="img" aria-label="New messages in another workspace" />}
                <span className="truncate">{orgName}</span>
              </span>,
            )}
          </>,
          "Settings",
        )}
        <SignOutButton icon={false} className="w-full min-h-[52px] rounded-[14px] bg-card text-bad text-body font-medium" />
      </div>
      {orgs && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && setOrgs(false)}>
          <div role="dialog" aria-modal="true" aria-label="Workspaces" className="w-full bg-panel border-t border-line rounded-t-[16px] pb-6 safe-bottom">
            <div className="flex justify-end p-3.5 pb-0">
              <button onClick={() => setOrgs(false)} aria-label="Close" className="circle">
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
