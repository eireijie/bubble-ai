import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, Brain, Building2, ChevronLeft, LifeBuoy, ListTodo, SquarePen, ChevronRight, LogOut, Moon, Settings, Sparkles, Store, Sun, SunMoon, Blocks, X } from "lucide-react";
import { api, connectEvents, getToken, setToken } from "./api.ts";
import { useInboxCount, useStore } from "./store.ts";
import { go, href, parseRoute, routeForRole, useRoute, type Route } from "./router.ts";
import { useAppearance, type ModeChoice } from "./theme.ts";
import { ChatList, NewChatPicker } from "./components/ChatList.tsx";
import { Rail, rememberChat } from "./components/Rail.tsx";
import { OfflineBanner, UpdatedBanner } from "./components/Banners.tsx";
import { OrgList, useOrgs } from "./components/OrgSwitcher.tsx";
import { ChannelBrowser } from "./components/Channels.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { ChannelView } from "./views/ChannelView.tsx";
import { logout } from "./logout.ts";
import { JoinApproval } from "./components/JoinApproval.tsx";
import { HelpPopup } from "./components/HelpPopup.tsx";
import { DashboardView } from "./views/DashboardView.tsx";
import { primeTasks } from "./notifications.ts";
import { Loader, cx } from "./components/ui.tsx";
import { enterDeskPane, enterPane, staggerRows, usePresence } from "./motion.ts";
import { setupProgress, useDismissed, useOnboarding } from "./onboarding.ts";
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
const ModsPage = lazyView(() => import("./views/settings/features.tsx").then((m) => m.ModsPage));
const HelpView = lazyView(() => import("./views/HelpView.tsx").then((m) => m.HelpView));
const BuddyView = lazyView(() => import("./views/BuddyView.tsx").then((m) => m.BuddyView));
const AuthorizeView = lazyView(() => import("./views/AuthorizeView.tsx").then((m) => m.AuthorizeView));

/** The file the page at this address needs, so it can be fetched while the data is still on its way. */
export const preloadRoute = (route: Route): Promise<void> => viewFor(route)?.preload() ?? Promise.resolve();
function viewFor(route: Route): Pick<LazyView<object>, "preload"> | null {
  const views: Partial<Record<Route["view"], Pick<LazyView<object>, "preload">>> = {
    more: MorePage, vault: VaultView, agents: AgentsView, you: YouPage, settings: SettingsView, welcome: WelcomeView, here: HereView, about: AboutView,
    computers: ComputersView, tasks: TasksView, code: CodeView, marketplace: MarketplaceView, connectors: MarketplaceView, skills: MarketplaceView, mods: ModsPage,
    help: HelpView, buddy: BuddyView, authorize: AuthorizeView,
  };
  return views[route.view] ?? null;
}

export function App() {
  const route = useRoute();
  // a page's file arrives behind the same ghost the app starts with (the desk buddy's window stays clear)
  return (
    <Suspense fallback={route.view === "buddy" ? null : <Loader />}>
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

/** Unread messages on the app icon: the Dock in Wisp's desktop app, or the installed PWA's badge. */
function useUnreadBadge() {
  const unread = useStore((s) => s.channels.reduce((n, c) => n + (c.unread || 0), 0));
  useEffect(() => {
    const desktop = (window as { wispDesktop?: { setBadge(n: number): void } }).wispDesktop;
    if (desktop) return desktop.setBadge(unread);
    const nav = navigator as Navigator & { setAppBadge?(n: number): Promise<void>; clearAppBadge?(): Promise<void> };
    (unread ? nav.setAppBadge?.(unread) : nav.clearAppBadge?.())?.catch(() => {});
  }, [unread]);
}

/** The chat or team with the newest message: where the Chats item lands when you haven't been in one yet. */
function newestChat(): string | null {
  const { channels } = useStore.getState();
  let best: { id: string; at: number } | null = null;
  for (const c of channels) {
    if (c.archivedAt || (c.kind === "channel" && !c.joined)) continue;
    const at = Date.parse(c.last?.at ?? c.createdAt);
    if (!best || at > best.at) best = { id: c.id, at };
  }
  return best?.id ?? null;
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
  const loaded = useStore((s) => s.channels.length > 0);
  const waiting = useInboxCount();
  const route = routeForRole(useRoute(), me?.role);
  const phone = useIsPhone();
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
  }, [route]);

  // the phone-only pages have desktop equivalents, and the bare root is the chats list on phones
  useEffect(() => {
    // the bare root on desktops: what needs you when something does, else the chat you were last in
    // (replace, so Back doesn't bounce here again)
    if (!phone && route.view === "chat" && !route.channelId) {
      const newest = waiting > 0 ? null : newestChat();
      location.replace(newest ? href({ view: "chat", channelId: newest, threadId: null }) : href({ view: "dashboard" }));
    }
    if (!phone && route.view === "you") go({ view: "settings" });
    if (!phone && route.view === "more") go({ view: "dashboard" });
    if (phone && route.view === "chat" && !route.channelId) go({ view: "chats" });
  }, [phone, route, loaded, waiting]);

  if (error)
    return (
      <div className="h-full grid place-items-center p-6 text-center text-sm">
        <div className="space-y-3">
          <p>Couldn't reach the Wisp hub: {error}</p>
          <button className="underline" onClick={() => location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  if (!me) return <Loader />;

  const toChats = () => go({ view: "chats" });
  const toYou = () => go({ view: "you" });
  // phones have no tab bar: a page whose own header has no Back gets a slim bar with one
  const backBar = (node: ReactNode, pull = true, to: Route = { view: "you" }) => (phone ? <PhoneBack to={href(to)} pull={pull}>{node}</PhoneBack> : node);
  const view = (() => {
    switch (route.view) {
      case "chat":
        // the bare root: the Inbox on desktops, the chats list on phones (the effect above fixes the URL)
        if (!route.channelId) return phone ? <ChatsPage route={route} /> : <DashboardView />;
        return <ChannelView route={route} onBack={phone ? toChats : undefined} />;
      case "chats":
        return phone ? <ChatsPage route={route} /> : <DesktopChats route={route} />;
      case "you":
        return <YouPage />;
      case "more":
        return <MorePage />;
      case "dashboard":
        return <DashboardView onBack={phone ? toChats : undefined} />;
      case "marketplace":
        return <MarketplaceView section={route.section ?? "all"} onBack={phone ? toYou : undefined} />;
      // older addresses: a sign-in coming back lands on what's installed
      case "connectors":
        return <MarketplaceView section={new URLSearchParams(location.search).has("signin") ? "installed" : "apps"} onBack={phone ? toYou : undefined} />;
      case "skills":
        return <MarketplaceView section="skills" onBack={phone ? toYou : undefined} />;
      case "vault":
        return <VaultView path={route.path} onBack={phone ? toYou : undefined} />;
      case "agents":
        // one agent's page has its own Back to the list
        return route.agentId ? <AgentsView agentId={route.agentId} tab={route.tab ?? null} /> : backBar(<AgentsView agentId={route.agentId} tab={route.tab ?? null} />);
      case "about":
        return <AboutView onBack={phone ? toYou : undefined} />;
      case "tasks":
        return <TasksView onBack={phone ? toYou : undefined} />;
      case "code":
        return backBar(<CodeView />, false);
      case "computers": {
        const computers = <ComputersView computerId={route.computerId} teach={route.teach ?? null} deviceId={route.deviceId ?? null} />;
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
      case "mods":
        return (
          <div className="flex-1 overflow-y-auto">
            {phone && (
              <header className="px-[18px] pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-3">
                <button className="circle shrink-0" onClick={toYou} aria-label="Back">
                  <ChevronLeft size={22} aria-hidden />
                </button>
                <h1 className="t-title truncate">Mods</h1>
              </header>
            )}
            <div className="max-w-4xl mx-auto px-4 md:px-8 pt-4 md:pt-10 pb-8">
              <ModsPage />
            </div>
          </div>
        );
    }
  })();
  // a page whose file isn't in yet (only in the app's first moments) holds its place, empty, until it is
  const page = <Suspense fallback={<div className="flex-1 min-h-0" />}>{view}</Suspense>;
  if (chatOpen) heldChat.current = page;
  const chatLayer = chatOpen || chatPresence.mounted;
  const dialogs = (
    <>
      <CommandPalette />
      <JoinApproval />
      <HelpPopup />
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
    <div ref={shellRef} className="h-full flex overflow-hidden bg-app">
      {!phone && <Rail route={route} />}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="relative flex-1 min-h-0 flex">
          <main ref={mainRef} className="flex-1 min-w-0 min-h-0 flex flex-col bg-panel overflow-hidden">
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
    </div>
  );
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
