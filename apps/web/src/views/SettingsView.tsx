import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Blocks, ChevronLeft, ChevronRight, Compass, Info, Monitor, Search, ShieldCheck, UserRound } from "lucide-react";
import { LearnPage } from "../components/tour/Learn.tsx";
import { BubbleIcon } from "../components/icons.tsx";
import { useStore } from "../store.ts";
import { go, href, useRoute, type SettingsPage } from "../router.ts";
import { cx } from "../components/ui.tsx";
import { PopNav } from "../components/SettingsDialog.tsx";
import { initialsOf } from "../components/Rail.tsx";
import { findByWords } from "../components/searchIndex.ts";
import { useFeatures } from "../features.ts";
import { NotificationsPage, PasswordForm, SessionsPage } from "./settings/account.tsx";
import { AskBeforePage, ConnectionsPage, DataPage, GeneralPage, MemoryRules, OrgoPage, PeoplePage } from "./settings/workspace.tsx";
import { RuntimesPage } from "./settings/runtimes.tsx";
import { HarnessesPage } from "./settings/harnesses.tsx";
import { ModelsPage } from "./settings/models.tsx";
import { VoicePage } from "./settings/voice.tsx";
import { ImportFromAI, MemoryFolderPage, ObsidianPage } from "./settings/memory.tsx";
import { SkillsPage } from "./settings/skills.tsx";
import { OutsideApps } from "./settings/devices.tsx";
import { PhonePairing } from "./settings/mobile.tsx";
import { LoginsPage } from "./settings/logins.tsx";
import { StoragePage } from "./settings/storage.tsx";
import { ApplePage } from "./settings/apple.tsx";
import { UsagePage } from "./settings/usage.tsx";
import { AskAndChanges } from "./settings/changes.tsx";
import { AgentDefaultsPage } from "./settings/defaults.tsx";
import { AboutPage, WhatsNewPage } from "./settings/about.tsx";
import { AgentsFive, ComputersFive, ModsFive, PrivacyFive, YouFive } from "./settings/five.tsx";
import { MarketplaceView } from "./MarketplaceView.tsx";
import { MergedPageContext } from "./settings/parts.tsx";
import { FiveContext, rowDomId } from "./settings/rows.tsx";
import { setFeatures } from "../features.ts";
import { FEATURE_INFO, type FeatureKey } from "@bubble-ai/core";
import { FIVE_LABEL, FIVE_ROUTE, fivePages, rowAvailable, rowById, rowTarget, searchableRows, settingsLanding, type Five, type SettingRow } from "./settings/map.ts";

/**
 * Settings: six pages (You, Agents, Mods, Computers, Privacy and data, About), and a search over
 * every setting; every row is on its page, in small titled groups. The map of rows, and where each of the 24 old
 * routes lands, is in settings/map.ts. A row with more inside opens as a sheet in the same place.
 */
const FIVE_PAGE: Record<Five, () => ReactNode> = {
  you: () => <YouFive />,
  agents: () => <AgentsFive />,
  mods: () => <ModsFive />,
  computers: () => <ComputersFive />,
  privacy: () => <PrivacyFive />,
  about: () => <AboutPage />,
  learn: () => <LearnPage />,
};

/** What each sheet row opens, by row id. (Apps is the Add page's "installed" list, which fills the pane itself.) */
const SHEETS: Record<string, () => ReactNode> = {
  notifications: () => <NotificationsPage />,
  voice: () => <VoicePage />,
  thinks: () => <AgentDefaultsPage />,
  asks: () => <AskBeforePage />,
  accounts: () => <ModelsPage />,
  usage: () => <UsagePage />,
  logins: () => <LoginsPage />,
  outside: () => (
    <>
      <OutsideApps />
      <div className="mt-7">
        <ConnectionsPage />
      </div>
    </>
  ),
  // the AI tools on each computer, then installing more
  tools: () => (
    <>
      <HarnessesPage />
      <MergedPageContext.Provider value>
        <RuntimesPage />
      </MergedPageContext.Provider>
      <a href={href({ view: "settings", ...rowTarget(rowById("accounts")) })} className="mt-7 flex items-center gap-3 px-5 min-h-[52px] rounded-[12px] bg-card text-body hover:bg-hover">
        <span className="flex-1">{rowById("accounts").label}</span>
        <ChevronRight size={15} className="text-faint" aria-hidden />
      </a>
    </>
  ),
  skills: () => <SkillsPage />,
  apps: () => <MarketplaceView section="installed" embedded />,
  storage: () => <StoragePage />,
  apple: () => <ApplePage />,
  phone: () => <PhonePairing compact />,
  cloud: () => <OrgoPage />,
  password: () => <PasswordForm />,
  sessions: () => <SessionsPage />,
  people: () => <PeoplePage />,
  "memory-access": () => <MemoryRules />,
  "memory-folder": () => <MemoryFolderPage />,
  backup: () => <DataPage />,
  workspace: () => <GeneralPage />,
  changes: () => <AskAndChanges />,
  obsidian: () => <ObsidianPage />,
  import: () => <ImportFromAI />,
  news: () => <WhatsNewPage />,
};
/** The rows that have a sheet to open (map.ts marks the same ones `sheet`). */
export const SHEET_IDS = Object.keys(SHEETS);

/** Each page's line icon in the list down the left. */
const FIVE_ICON: Record<Five, ReactNode> = {
  you: <UserRound size={20} strokeWidth={1.8} />,
  agents: <BubbleIcon size={20} strokeWidth={1.8} />,
  computers: <Monitor size={20} strokeWidth={1.8} />,
  privacy: <ShieldCheck size={20} strokeWidth={1.8} />,
  about: <Info size={20} strokeWidth={1.8} />,
  learn: <Compass size={20} strokeWidth={1.8} />,
  mods: <Blocks size={20} strokeWidth={1.8} />,
};

/** A mod's settings while it's off: one line and the switch that turns it on (owners only). */
function ModOff({ mod, owner }: { mod: FeatureKey; owner: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnOn = () => {
    setBusy(true);
    setFeatures({ [mod]: true }).then(
      () => setError(null),
      (e) => (setError((e as Error).message), setBusy(false)),
    );
  };
  return (
    <div className="px-1 flex flex-wrap items-center gap-3 text-sm text-muted">
      <span>{FEATURE_INFO[mod].description}</span>
      {owner ? (
        <button type="button" disabled={busy} onClick={turnOn} className="font-medium text-ink hover:underline disabled:opacity-50">
          Turn on
        </button>
      ) : (
        <span>Only owners can turn it on.</span>
      )}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

/** The top of You: your picture, your name, your role and workspace. */
function YouHeader() {
  const me = useStore((s) => s.me)!;
  return (
    <div className="mb-5 flex items-center gap-3.5">
      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-wisp-soft text-[17px] font-semibold text-wisp-strong" aria-hidden>
        {initialsOf(me.user.name)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[17px] font-semibold leading-6">{me.user.name}</div>
        <div className="truncate text-[13px] text-muted">
          {me.role === "owner" ? "Owner" : me.role === "guest" ? "Guest" : "Member"} · {me.workspace.name}
        </div>
      </div>
    </div>
  );
}

const pageTop = (p: Five) => href({ view: "settings", page: FIVE_ROUTE[p] });
const rowHref = (r: SettingRow) => href({ view: "settings", ...rowTarget(r) });

function SearchField({ value, onChange, onEnter, className }: { value: string; onChange: (v: string) => void; onEnter: () => void; className?: string }) {
  return (
    <label className={cx("flex items-center gap-2 h-9 px-3 rounded-[18px] bg-card text-sm focus-within:ring-2 focus-within:ring-ring/40", className)}>
      <Search size={15} className="shrink-0 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter();
          if (e.key === "Escape") onChange("");
        }}
        placeholder="Search settings"
        aria-label="Search settings"
        className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

export function SettingsView({ page, onBack, fullWindow }: { page: SettingsPage | null; onBack?: () => void; fullWindow?: boolean }) {
  const me = useStore((s) => s.me)!;
  const guest = me.role === "guest";
  const features = useFeatures();
  const route = useRoute();
  const item = route.view === "settings" ? (route.item ?? null) : null;
  const pages = fivePages(guest, features);
  const [query, setQuery] = useState("");
  const [pulse, setPulse] = useState(0);
  const [target, setTarget] = useState<string | null>(null);

  // where the address lands; something a guest can't use lands on the first page instead
  const wanted = page ? settingsLanding(page, item) : null;
  const wantedRow = wanted?.row ? rowById(wanted.row) : null;
  const allowed = !!wanted && pages.includes(wanted.page) && !(wantedRow && guest && wantedRow.noGuests);
  const landing = wanted && allowed ? wanted : wanted ? settingsLanding(null) : null;
  const row = landing?.row ? rowById(landing.row) : null;
  const current: Five | null = landing?.page ?? (fullWindow ? pages[0] : null);
  const sheet = row && landing?.sheet ? row : null;
  // its mod is switched off: say so instead of opening it
  const modOff = !!row && !rowAvailable(row, guest, features);

  // arriving at a row: bring it into view and mark it for a moment
  useEffect(() => {
    if (!current || !row || modOff) return;
    if (sheet) return;
    setTarget(row.id);
    const look = setTimeout(() => document.getElementById(rowDomId(row.id))?.scrollIntoView({ block: "center" }), 60);
    const done = setTimeout(() => setTarget(null), 1800);
    return () => {
      clearTimeout(look);
      clearTimeout(done);
    };
  }, [current, row?.id, sheet?.id, modOff, pulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const found = useMemo(() => (query.trim() ? findByWords(query, searchableRows(guest, features)) : []), [query, guest, features]);
  const pick = () => {
    setQuery("");
    setPulse((n) => n + 1);
  };
  const openFirst = () => {
    if (!found[0]) return;
    go({ view: "settings", ...rowTarget(found[0]) });
    pick();
  };

  const results = (
    <div className="rounded-[12px] bg-card divide-y divide-line overflow-hidden" role="list" aria-label="Settings that match">
      {found.map((r) => (
        <a key={r.id} role="listitem" href={rowHref(r)} onClick={pick} className="flex items-center gap-3 px-4 min-h-[52px] text-body hover:bg-hover">
          <span className="flex-1 min-w-0 truncate">{r.label}</span>
          <span className="shrink-0 text-[13px] text-muted">{FIVE_LABEL[r.page]}</span>
        </a>
      ))}
      {found.length === 0 && <p className="px-4 py-3.5 text-sm text-muted">No settings match</p>}
    </div>
  );

  const pageBody = (p: Five) => (
    <FiveContext.Provider value={{ page: p, guest, features, landed: row && !sheet ? row.id : null, target }}>
      <div data-tour="settings-page" className="space-y-4">{FIVE_PAGE[p]()}</div>
    </FiveContext.Provider>
  );
  // a mod's own settings (Storage, Apple) while the mod is off: turn it on right here
  const offMod = row?.mod && !features[row.mod] ? row.mod : null;
  const sheetBody = (r: SettingRow) =>
    modOff ? (
      <p className="px-1 text-sm text-muted">
        {r.label} is off.{" "}
        <a className="text-accent-text hover:underline" href={href({ view: "settings", page: "mods" })}>
          Turn it on
        </a>
      </p>
    ) : offMod ? (
      <ModOff mod={offMod} owner={me.role === "owner"} />
    ) : (
      SHEETS[r.id]()
    );
  // the installed apps list is the Add page's own view: it fills the pane and scrolls by itself
  const fills = sheet?.id === "apps" && !modOff;
  const bottom = "pb-[max(2rem,env(safe-area-inset-bottom))]";

  if (fullWindow)
    return (
      <div className="flex-1 min-w-0 min-h-0 flex">
        <aside className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-sidebar px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-6">
          <h2 className="mb-3 px-2 text-[15px] font-semibold">Settings</h2>
          <SearchField value={query} onChange={setQuery} onEnter={openFirst} className="mb-3 bg-panel" />
          <PopNav label="Settings" current={query ? null : current} onPick={() => setQuery("")} items={pages.map((p) => ({ key: p, label: FIVE_LABEL[p], icon: FIVE_ICON[p], href: pageTop(p) }))} />
        </aside>
        <main className="flex-1 min-w-0 min-h-0 flex flex-col" aria-label={query ? "Settings search" : `${sheet?.label ?? FIVE_LABEL[current!]} settings`}>
          {fills && !query ? (
            SHEETS.apps()
          ) : (
            <div key={query ? "search" : `${current}:${sheet?.id ?? ""}`} className="settings-pop-section flex-1 min-h-0 overflow-y-auto">
              <div className={cx("max-w-[720px] pl-10 pr-16 pt-8", bottom)}>
                {query ? (
                  <>
                    <h1 className="t-title mb-4">Search</h1>
                    {results}
                  </>
                ) : sheet ? (
                  <>
                    <a href={pageTop(current!)} className="-ml-1 mb-1 inline-flex items-center gap-0.5 h-7 text-[13px] text-muted hover:text-ink">
                      <ChevronLeft size={15} aria-hidden /> {FIVE_LABEL[current!]}
                    </a>
                    <h1 className="t-title mb-4">{sheet.label}</h1>
                    <div data-tour="settings-sheet">{sheetBody(sheet)}</div>
                  </>
                ) : (
                  <>
                    <h1 className="t-title mb-4">{FIVE_LABEL[current!]}</h1>
                    {current === "you" && <YouHeader />}
                    {pageBody(current!)}
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    );

  // phones: the five pages as a list with the search on top, then a page, then a sheet, each with Back
  const back = sheet ? () => go({ view: "settings", page: FIVE_ROUTE[current!] }) : current ? () => go({ view: "settings", page: null }) : onBack;
  if (fills) return <MarketplaceView section="installed" embedded onBack={back} />;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 flex items-center gap-3">
        {back && (
          <button className="circle shrink-0" onClick={back} aria-label={sheet ? `Back to ${FIVE_LABEL[current!]}` : current ? "Back to all settings" : "Back"}>
            <ChevronLeft size={22} aria-hidden />
          </button>
        )}
        {current ? <h1 className="t-title truncate">{sheet?.label ?? FIVE_LABEL[current]}</h1> : <SearchField value={query} onChange={setQuery} onEnter={openFirst} className="flex-1" />}
      </header>
      <div key={`${current}:${sheet?.id ?? ""}`} className="flex-1 min-h-0 overflow-y-auto">
        <div className={cx("px-4 pt-2", bottom)}>
          {sheet ? (
            <div data-tour="settings-sheet">{sheetBody(sheet)}</div>
          ) : current ? (
            pageBody(current)
          ) : query ? (
            results
          ) : (
            <nav data-tour="settings-home" aria-label="Settings" className="rounded-[12px] bg-card divide-y divide-line overflow-hidden">
              {pages.map((p) => (
                <a key={p} href={pageTop(p)} className="flex items-center gap-3 px-4 min-h-[52px] text-body hover:bg-hover">
                  <span className="flex-1">{FIVE_LABEL[p]}</span>
                  <ChevronRight size={15} className="text-faint" aria-hidden />
                </a>
              ))}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
