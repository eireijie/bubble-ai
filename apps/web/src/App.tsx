import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { api, connectEvents, getToken, setToken } from "./api.ts";
import { useStore } from "./store.ts";
import { closePopup, go, href, isDialogRoute, parseRoute, popupKey, popupSize, routeForRole, appHashBeforeSettings, useRoute, type Route } from "./router.ts";
import { useAppearance, type ModeChoice } from "./theme.ts";
import { ChatList, NewChatPicker } from "./components/ChatList.tsx";
import { Rail, homeChat, rememberChat } from "./components/Rail.tsx";
import { OfflineBanner, UpdatedBanner } from "./components/Banners.tsx";
import { OrgList, useOrgs } from "./components/OrgSwitcher.tsx";
import { ChannelBrowser } from "./components/Channels.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { ChannelView } from "./views/ChannelView.tsx";
import { logout } from "./logout.ts";
import { JoinApproval } from "./components/JoinApproval.tsx";
import { HelpPopup } from "./components/HelpPopup.tsx";
import { TourOverlay } from "./components/tour/TourOverlay.tsx";
import { DashboardView } from "./views/DashboardView.tsx";
import { primeTasks } from "./notifications.ts";
import { Loader, cx } from "./components/ui.tsx";
import { enterDeskPane, enterPane, staggerRows, usePresence } from "./motion.ts";
import { noteAppPage, setupProgress, useDismissed, useOnboarding } from "./onboarding.ts";
import { useFeatures } from "./features.ts";
import { useDesktopAgents } from "./desktop.ts";
import { lazyView, preloadViews, type LazyView } from "./lazy.tsx";

// The shell, the Inbox and the open chat come with the app. Every other page is a file of its own,
// fetched in the background once the app is up (lazy.tsx), so the first file stays small.
const MorePage = lazyView(() => import("./views/MorePage.tsx").then((m) => m.MorePage));
const VaultView = lazyView(() => import("./views/VaultView.tsx").then((m) => m.VaultView));
const AgentsView = lazyView(() => import("./views/AgentsView.tsx").then((m) => m.AgentsView));
const YouPage = lazyView(() => import("./views/YouPage.tsx").then((m) => m.YouPage));
const SettingsView = lazyView(() => import("./views/SettingsView.tsx").then((m) => m.SettingsView));
const AuthScreen = lazyView(() => import("./views/AuthScreen.tsx").then((m) => m.AuthScreen));
const WelcomeView = lazyView(() => import("./views/WelcomeView.tsx").then((m) => m.WelcomeView));
const HereView = lazyView(() => import("./views/HereView.tsx").then((m) => m.HereView));
const AboutView = lazyView(() => import("./views/AboutView.tsx").then((m) => m.AboutView));
const ComputersView = lazyView(() => import("./views/ComputersView.tsx").then((m) => m.ComputersView));
const TasksView = lazyView(() => import("./views/TasksView.tsx").then((m) => m.TasksView));
const NewTask = lazyView(() => import("./views/TasksView.tsx").then((m) => m.NewTask));
const CodeView = lazyView(() => import("./views/CodeView.tsx").then((m) => m.CodeView));
const MarketplaceView = lazyView(() => import("./views/MarketplaceView.tsx").then((m) => m.MarketplaceView));
const HelpView = lazyView(() => import("./views/HelpView.tsx").then((m) => m.HelpView));
const TemplatesView = lazyView(() => import("./views/TemplatesView.tsx").then((m) => m.TemplatesView));
const BuddyView = lazyView(() => import("./views/BuddyView.tsx").then((m) => m.BuddyView));
const AuthorizeView = lazyView(() => import("./views/AuthorizeView.tsx").then((m) => m.AuthorizeView));

/** The file the page at this address needs, so it can be fetched while the data is still on its way. */
export const preloadRoute = (route: Route): Promise<void> => viewFor(route)?.preload() ?? Promise.resolve();
function viewFor(route: Route): Pick<LazyView<object>, "preload"> | null {
  const views: Partial<Record<Route["view"], Pick<LazyView<object>, "preload">>> = {
    more: MorePage, vault: VaultView, agents: AgentsView, you: YouPage, settings: SettingsView, welcome: WelcomeView, here: HereView, about: AboutView,
    computers: ComputersView, tasks: TasksView, code: CodeView, marketplace: MarketplaceView, connectors: MarketplaceView, skills: MarketplaceView, mods: MarketplaceView,
    help: HelpView, buddy: BuddyView, authorize: AuthorizeView, templates: TemplatesView,
  };
  return views[route.view] ?? null;
}

export function App() {
  const route = useRoute();
  // a page's file arrives behind the same ghost the app starts with (the desk buddy's window stays clear)
  return (
    // before anyone is signed in (straight from the desktop's setup page) the page just stays clear: no bubble pops in and out
    <Suspense fallback={route.view === "buddy" ? null : getToken() ? <Loader /> : <div className="h-full w-full bg-panel" />}>
      <Routed route={route} />
    </Suspense>
  );
}

function Routed({ route }: { route: Route }) {
  const [authed, setAuthed] = useState(() => !!getToken());
  useEffect(() => {
    if (!authed && route.view !== "buddy") window.wispDesktop?.buddy.agents([], null);
  }, [authed, route.view]);
  if (route.view === "buddy") return <BuddyView />;
  if (!authed)
    return (
      <AuthScreen
        onAuthed={(t) => {
          setToken(t);
          setAuthed(true);
        }}
      />
    );
  if (route.view === "authorize") return <AuthorizeView requestId={route.requestId} />;
  return <Workspace />;
}

/** Phones get full-screen pages, with the list of agents as home and no tab bar; larger screens get the sidebar. */
function useIsPhone() {
  const query = "(max-width: 767px)";
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/** Unread messages on the app icon: the Dock in Bubble AI's desktop app, or the installed PWA's badge. */
function useUnreadBadge() {
  const unread = useStore((s) => s.channels.reduce((n, c) => n + (c.unread || 0), 0));
  useEffect(() => {
    const desktop = (window as { wispDesktop?: { setBadge(n: number): void } }).wispDesktop;
    if (desktop) return desktop.setBadge(unread);
    const nav = navigator as Navigator & { setAppBadge?(n: number): Promise<void>; clearAppBadge?(): Promise<void> };
    (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => {});
  }, [unread]);
}

/** Which page a route belongs to. Moving between groups animates; moving within one doesn't. */
function tabGroup(route: Route): string {
  switch (route.view) {
    case "chat":
    case "chats":
      return "home";
    case "you":
    case "more":
      return "you";
    default:
      return route.view;
  }
}
/** Phones: how deep a page sits. Home, then the account page, then the pages it opens: going deeper comes in from the right. */
const tabOrder = (group: string) => (group === "home" ? 0 : group === "you" ? 1 : 2);

/** Phones: the open chat, a layer that slides in over the list (and out again when it leaves). */
function ChatLayer({ leaving, instant, children }: { leaving: boolean; instant: boolean; children: ReactNode }) {
  // a chat that's already open when the app loads is simply there, it doesn't slide in
  const [skip] = useState(instant);
  return (
    <div className="m-chat-layer absolute inset-0 z-10 flex flex-col bg-panel" data-state={leaving ? "out" : "in"} data-skip={skip || undefined}>
      {children}
    </div>
  );
}

function Workspace() {
  const me = useStore((s) => s.me);
  const load = useStore((s) => s.load);
  const userId = me?.user.id;
  const handle = useStore((s) => s.handle);
  const setConnected = useStore((s) => s.setConnected);
  const newTaskOpen = useStore((s) => s.newTaskOpen);
  const newChatOpen = useStore((s) => s.newChatOpen);
  const channelBrowser = useStore((s) => s.channelBrowser);
  // the first load is in (me, chats and agents arrive together)
  const loaded = useStore((s) => !!s.me);
  const asked = routeForRole(useRoute(), me?.role);
  const phone = useIsPhone();
  // desktops: most places pop up over the page you were on (the chat), which stays under them
  const popped = !phone && isDialogRoute(asked);
  const under = popped ? routeForRole(parseRoute(appHashBeforeSettings()), me?.role) : asked;
  // desktops open on the chat you were last in (#/), never on a list of places
  const home = useStore((s) => (phone ? null : homeChat(s.channels)));
  const route: Route = !phone && under.view === "chat" && !under.channelId && home ? { view: "chat", channelId: home, threadId: null } : under;
  const popPresence = usePresence(popped, 140);
  const heldPop = useRef<{ route: Route; node: ReactNode } | null>(null);
  // Memory's graph asks for the whole window while it shows (it is a canvas you drag around)
  const [popFull, setPopFull] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load().catch((e) => setError(e.message));
    return connectEvents(handle, setConnected);
  }, [load, handle, setConnected]);
  // the rest of the app's files come in the background once it's up
  useEffect(() => {
    if (userId) preloadViews();
  }, [userId]);
  // so a task finishing later can be told apart from one that was already done (notifications)
  useEffect(() => {
    if (userId) primeTasks();
  }, [userId]);
  useUnreadBadge();
  useDesktopAgents();

  // --- motion: tabs cross-fade, lists stagger, a chat slides in over the list on phones ---------------
  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const heldChat = useRef<ReactNode>(null);
  useEffect(() => {
    if (me) started.current = true;
  }, [me]);
  const group = tabGroup(route);
  const chatKey = route.view === "chat" ? route.channelId : null;
  const chatOpen = phone && route.view === "chat" && !!route.channelId;
  const chatPresence = usePresence(chatOpen, 320);
  const was = useRef({ group, chatKey });
  // runs when the tab or the open chat changes, never on a plain re-render
  useLayoutEffect(() => {
    const before = was.current;
    was.current = { group, chatKey };
    if (!started.current) return;
    const groupChanged = before.group !== group;
    if (!groupChanged && before.chatKey === chatKey) return;
    if (phone) {
      if (groupChanged) {
        enterPane(baseRef.current, tabOrder(group) > tabOrder(before.group) ? 8 : -8);
        staggerRows(shellRef.current);
      }
      return;
    }
    const panes = Array.from(mainRef.current?.children ?? []);
    if (groupChanged) {
      enterDeskPane(panes, 8, 180);
      staggerRows(shellRef.current);
    } else enterDeskPane(panes, 6, 160);
  }, [group, chatKey, phone]);

  useEffect(() => {
    if (route.view === "chat") rememberChat(route.channelId);
    // the first run, opened from inside the app, has a Back to where it was opened from
    if (asked.view !== "welcome") noteAppPage(location.hash);
  }, [route, asked]);

  // the phone-only pages have desktop equivalents, and the bare root is the chats list on phones
  useEffect(() => {
    // the bare root on desktops: the chat you were last in (replace, so Back doesn't bounce here
    // again). Not while a pop-up is open over it: that would close it
    if (!phone && loaded && !popped && asked.view === "chat" && !asked.channelId && home) location.replace(href({ view: "chat", channelId: home, threadId: null }));
    if (!phone && asked.view === "you") go({ view: "settings" });
    if (!phone && asked.view === "more") go({ view: "chat", channelId: null, threadId: null });
    // Mods live in Settings on desktops
    if (!phone && asked.view === "mods") location.replace(href({ view: "settings", page: "mods" }));
    if (phone && route.view === "chat" && !route.channelId) go({ view: "chats" });
  }, [phone, route, asked, loaded, popped, home]);
  // a different pop-up starts at its own size
  const popKey = popped ? popupKey(asked) : null;
  useEffect(() => {
    if (popKey !== "vault") setPopFull(false);
  }, [popKey]);

  if (error)
    return (
      <div className="h-full grid place-items-center p-6 text-center text-sm">
        <div className="space-y-3">
          <p>Couldn't reach the Bubble AI hub: {error}</p>
          <button className="underline" onClick={() => location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  if (!me) return <Loader launch />;

  const toChats = () => go({ view: "chats" });
  const toYou = () => go({ view: "you" });
  // phones have no tab bar: a page whose own header has no Back gets a slim bar with one
  const backBar = (node: ReactNode, pull = true, to: Route = { view: "you" }) => (phone ? <PhoneBack to={href(to)} pull={pull}>{node}</PhoneBack> : node);
  const viewFor = (route: Route): ReactNode => {
    switch (route.view) {
      case "chat":
        // the bare root: the chats list on phones; on desktops the last chat (above), or with no chats at all, what needs you
        if (!route.channelId) return phone ? <ChatsPage route={route} /> : <DashboardView />;
        // the chat keeps its own type sizes (tokens.css)
        return (
          <div className="type-chat contents">
            <ChannelView route={route} onBack={phone ? toChats : undefined} />
          </div>
        );
      case "chats":
        return <div className="type-chat contents">{phone ? <ChatsPage route={route} /> : <DesktopChats route={route} />}</div>;
      case "you":
        return <YouPage />;
      case "more":
        return <MorePage />;
      case "dashboard":
        return <DashboardView onBack={phone ? toChats : undefined} />;
      case "marketplace":
        return <MarketplaceView section={route.section ?? "all"} app={route.app ?? null} forAgent={route.forAgent ?? null} onBack={phone ? toYou : undefined} />;
      // older addresses: a sign-in coming back lands on what's installed
      case "connectors":
        return <MarketplaceView section={new URLSearchParams(location.search).has("signin") ? "installed" : "apps"} onBack={phone ? toYou : undefined} />;
      case "skills":
        return <MarketplaceView section="skills" onBack={phone ? toYou : undefined} />;
      case "vault":
        return (
          <div data-tour="vault-page" className="contents">
            <VaultView path={route.path} onBack={phone ? toYou : undefined} />
          </div>
        );
      case "agents":
        // one agent's page has its own Back to the list
        return route.agentId ? <AgentsView agentId={route.agentId} tab={route.tab ?? null} /> : backBar(<AgentsView agentId={route.agentId} tab={route.tab ?? null} />);
      case "templates":
        return backBar(<TemplatesView />, true, { view: "agents", agentId: null });
      case "about":
        return <AboutView onBack={phone ? toYou : undefined} />;
      case "tasks":
        return <TasksView onBack={phone ? toYou : undefined} />;
      case "code":
        // its Back sits in Code's own bar, beside the pill, so there is no empty row above it
        return <CodeView back={phone ? href({ view: "you" }) : undefined} />;
      case "computers": {
        const computers = (
          <div data-tour="computers-page" className="contents">
            <ComputersView computerId={route.computerId} teach={route.teach ?? null} deviceId={route.deviceId ?? null} />
          </div>
        );
        // one computer or device has its own Back to the list
        return route.computerId || route.deviceId ? computers : backBar(computers);
      }
      case "settings":
        return <SettingsView page={route.page ?? null} onBack={toYou} fullWindow={!phone} />;
      case "welcome":
        return <WelcomeView intro={route.intro} />;
      case "here":
        return backBar(<HereView agentId={route.agentId} />, false, { view: "chats" });
      case "help":
        return <HelpView onBack={phone ? toYou : undefined} />;
      // mods are rows on the Add page now: this address opens it at Mods
      case "mods":
        return <MarketplaceView section="mods" onBack={phone ? toYou : undefined} />;
      case "buddy":
      case "authorize":
        return null;
    }
  };
  const view = viewFor(route);
  // a page whose file isn't in yet (only in the app's first moments) holds its place, empty, until it is
  // the first run covers the whole window from its first frame: the workspace never shows under it while it loads
  const page = <Suspense fallback={route.view === "welcome" ? <div className="fixed inset-0 z-40 bg-panel" /> : <div className="flex-1 min-h-0" />}>{view}</Suspense>;
  if (chatOpen) heldChat.current = page;
  const chatLayer = chatOpen || chatPresence.mounted;
  // the pop-up keeps what it showed while it closes
  if (popped) heldPop.current = { route: asked, node: <Suspense fallback={<div className="flex-1" />}>{viewFor(asked)}</Suspense> };
  const held = heldPop.current?.route;
  const popSize = held ? popupSize(held) : "large";
  const pop =
    (popped || popPresence.mounted) &&
    heldPop.current &&
    held &&
    (
      <SettingsDialog label={popupLabel(held)} closing={!popped} onClose={closePopup} size={popFull && held.view === "vault" ? "full" : popSize === "medium" || popSize === "profile" ? popSize : "large"} swapKey={popupKey(held)} setFull={setPopFull}>
        {heldPop.current.node}
      </SettingsDialog>
    );
  const dialogs = (
    <>
      <CommandPalette />
      <JoinApproval />
      <HelpPopup />
      <TourOverlay />
      <UpdatedBanner phone={phone} />
      {newChatOpen && <NewChatPicker onClose={() => useStore.setState({ newChatOpen: false })} />}
      {newTaskOpen && (
        <Suspense fallback={null}>
          <NewTask onClose={() => useStore.setState({ newTaskOpen: false })} />
        </Suspense>
      )}
      {channelBrowser && <ChannelBrowser sectionId={channelBrowser.sectionId} create={channelBrowser.create} onClose={() => useStore.setState({ channelBrowser: null })} />}
    </>
  );


  return (
    <div ref={shellRef} className="app-shell h-full flex overflow-hidden bg-app">
      <div className="titlebar-drag" aria-hidden />
      {!phone && <Rail route={route} popup={popped ? asked : null} />}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="relative flex-1 min-h-0 flex">
          <main ref={mainRef} inert={popped} className="app-main flex-1 min-w-0 min-h-0 flex flex-col bg-panel overflow-hidden">
            <OfflineBanner phone={phone} />
            {phone ? (
              // phones: the page, and over it the open chat. The page shifts back 96px and dims as the chat slides in
              <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
                <div ref={baseRef} data-open={chatOpen} inert={chatOpen} className={cx("m-under absolute inset-0 flex flex-col", route.view !== "vault" && "[&_.overflow-y-auto]:pb-[max(1.5rem,env(safe-area-inset-bottom))]")}>
                  {chatOpen ? <ChatsPage route={route} /> : page}
                </div>
                <div className="m-dim" data-open={chatOpen} aria-hidden />
                {chatLayer && heldChat.current && (
                  <ChatLayer leaving={!chatOpen} instant={!started.current}>
                    {heldChat.current}
                  </ChatLayer>
                )}
              </div>
            ) : (
              page
            )}
          </main>
        </div>
      </div>
      {dialogs}
      {pop}
    </div>
  );
}

/** What a pop-up is called, for people who can't see it. */
function popupLabel(r: Route): string {
  switch (r.view) {
    case "agents":
      return r.agentId ? "Agent profile" : "All agents";
    case "computers":
      return "Computers";
    case "vault":
      return "Memory";
    case "tasks":
      return "Tasks";
    case "marketplace":
    case "connectors":
    case "skills":
    case "mods":
      return "Apps and skills";
    case "help":
      return "Help";
    case "templates":
      return "Templates";
    case "about":
      return "What agents know";
    default:
      return "Settings";
  }
}

/**
 * Phones: a slim bar with Back, over a page whose own header has none. `pull` takes back the room
 * the page's header leaves for the status bar, which this bar already left.
 */
function PhoneBack({ to, pull, children }: { to: string; pull: boolean; children: ReactNode }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="relative z-10 shrink-0 flex items-center bg-panel px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <a href={to} className="circle" aria-label="Back">
          <ChevronLeft size={22} aria-hidden />
        </a>
      </div>
      <div className={cx("flex-1 min-h-0 flex flex-col", pull && "mt-[calc(-1*max(0px,env(safe-area-inset-top)_-_0.75rem))]")}>{children}</div>
    </div>
  );
}

/** Desktops: every chat, with search, sections and pins (the rail's search opens it). */
function DesktopChats({ route }: { route: Route }) {
  return (
    <div className="flex-1 min-h-0 flex justify-center px-7">
      <div className="w-full max-w-[720px] min-h-0">
        <ChatList route={route} />
      </div>
    </div>
  );
}

/** Phones: the home screen is the chats list. */
function ChatsPage({ route }: { route: Route }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <h1 className="sr-only">Chats</h1>
      <ChatList route={route} variant="page" />
    </div>
  );
}

export { logout };

// the page this address opens on: ask for its file now, alongside the first requests
if (typeof location !== "undefined") {
  void preloadRoute(parseRoute(location.hash));
  if (!getToken()) void AuthScreen.preload();
}
