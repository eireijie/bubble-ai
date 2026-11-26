import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { HARNESSES, MODEL_PROVIDER_INFO, harnessLabel, type HarnessSettings, type ModelConnection, type ModelProvider } from "@bubble-ai/core";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { unavailable } from "../../join.ts";
import { ConnectModel } from "../../components/ConnectModel.tsx";
import { HarnessLogo } from "../../components/HarnessLogo.tsx";
import { HOST_LOOK, HostGhost, hostReact } from "../../components/onboarding/HostGhost.tsx";
import { SetupLink, SetupProblem, SetupShell, SetupTitle } from "../../components/SetupShell.tsx";
import { canUse, readyConnection, signInProvider, useConnections } from "../../models.ts";
import type { DeviceInfo } from "../../devices.ts";
import type { HarnessesResponse, HarnessSignIn as HarnessSignInDialog } from "../settings/harnesses.tsx";
import { pointAgentAt } from "./firstAgent.ts";

/** The harnesses a connection is tried on, best first: the one the provider makes, then the open ones. */
const PREFERRED = ["claude-code", "codex", "hermes", "opencode", "goose"];

/** The best harness for a provider and kind of connection, from the shared support table. */
export function harnessFor(provider: ModelProvider, kind: "oauth" | "key", support: Parameters<typeof canUse>[0]): string {
  const own = MODEL_PROVIDER_INFO[provider].signIn?.[0]?.harness;
  if (kind === "oauth" && own) return own;
  return PREFERRED.find((h) => canUse(support, h, { provider, kind }) && support.length) ?? own ?? "hermes";
}

/** What's already set to go on the person's computer, best first: a connection Bubble AI keeps, then a harness signed in there. */
export function foundOn(device: DeviceInfo | undefined, connections: ModelConnection[]): { harness: string; connectionId: string | null; share?: boolean } | null {
  for (const h of ["claude-code", "codex"]) {
    const c = readyConnection(h, connections);
    if (c) return { harness: h, connectionId: c.id };
  }
  const signedIn = (id: string) => device?.harnesses?.find((x) => x.id === id)?.accounts?.default === true;
  if (signedIn("claude-code")) return { harness: "claude-code", connectionId: null };
  // Codex's own sign-in is shared with Bubble AI ("Use this sign-in"), so it works on every computer
  if (signedIn("codex")) return { harness: "codex", connectionId: null, share: true };
  for (const h of HARNESSES) if (h.protocol !== "mcp" && signedIn(h.id)) return { harness: h.id, connectionId: null };
  return null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How trying an AI ended: it answered, or it didn't and why (`resign`: that harness needs signing in again). */
export type Checked = { ok: true } | { ok: false; problem: string; resign?: string };

/**
 * Wait until the agent's AI can really answer: signed in where it runs, then its hello said (the
 * hello is its first real run; a status check can call a session signed in that can't refresh).
 * Anything else is a failure with one line saying what went wrong. Null when nobody is waiting any more.
 */
export async function checkAI(
  o: { agentId: string; harness: string; connectionId: string | null; deviceName: string },
  live: () => boolean = () => true,
  onStage: (s: "signin" | "hello") => void = () => {},
  io: { api: typeof api; wait: (ms: number) => Promise<unknown>; now: () => number } = { api, wait, now: Date.now },
): Promise<Checked | null> {
  const label = harnessLabel(o.harness);
  const again: Checked = { ok: false, problem: `${label} needs signing in again.`, resign: o.harness };
  const deadline = io.now() + 3 * 60_000;
  onStage("signin");
  while (live() && io.now() < deadline) {
    const r = await io.api<{ signedIn: boolean | null; inComputer?: boolean }>("GET", `/api/agents/${o.agentId}/harness`).catch(() => null);
    if (r && (r.signedIn === true || (r.signedIn === null && !o.connectionId && !r.inComputer))) {
      onStage("hello");
      while (live() && io.now() < deadline) {
        // signed out since (its run failed on sign-in): sign in again before anything else runs
        const now = await io.api<{ signedIn: boolean | null }>("GET", `/api/agents/${o.agentId}/harness`).catch(() => null);
        if (now?.signedIn === false) return again;
        const g = await io.api<{ status: string }>("POST", `/api/agents/${o.agentId}/greet`).catch(() => null);
        if (g?.status === "signin") return again;
        if (g?.status === "already" || g?.status === "sent") return live() ? { ok: true } : null;
        await io.wait(1500);
      }
      break;
    }
    if (r?.signedIn === false) return { ok: false, problem: `${label} isn't signed in on ${o.deviceName} yet.` };
    await io.wait(2000);
  }
  return live() ? { ok: false, problem: `${label} took too long to start.` } : null;
}

type Row = "claude" | "chatgpt" | "grok";
const ROWS: { id: Row; provider: ModelProvider; harness: string }[] = [
  { id: "claude", provider: "anthropic", harness: "claude-code" },
  { id: "chatgpt", provider: "openai", harness: "codex" },
  { id: "grok", provider: "xai", harness: "hermes" },
];
type Open = Row | "else" | "key" | null;
type Phase = "idle" | "checking" | "failed";

/**
 * The first run's third screen: what the agent thinks with. Claude, ChatGPT and Grok each open
 * their sign-in (one already signed in on the person's computer is used as it is); "Something
 * else" holds an API key, the other agents and "Set up later". Picking one points the agent at it
 * and waits until it has really answered: only then does its chat open. A sign-in that fails says
 * why in one line and stays here.
 */
export function AIStep({ agentId, device, onDone, onBack }: { agentId: string; device: DeviceInfo | undefined; onDone: (channelId: string | null) => void; onBack?: () => void }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === agentId));
  const { connections, support, reload } = useConnections();
  const found = foundOn(device, connections ?? []);
  const [open, setOpen] = useState<Open>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState<"install" | "signin" | "hello" | "opening">("signin");
  const [harness, setHarness] = useState(found?.harness ?? "claude-code");
  const [problem, setProblem] = useState<string | null>(null);
  // its AI said "signed in" but its first run couldn't sign in (an expired session): sign in again
  const [resign, setResign] = useState<string | null>(null);
  // what failed, to try again
  const [last, setLast] = useState<(() => void) | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [dialog, setDialog] = useState<{ Dialog: ComponentType<Parameters<typeof HarnessSignInDialog>[0]>; device: HarnessesResponse["device"]; settings: HarnessSettings } | null>(null);
  const run = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const name = agent?.name ?? "your agent";

  const fail = (text: string, re?: string) => {
    setResign(re ?? null);
    setProblem(text);
    setPhase("failed");
    // back to the choices, so a sign-in panel doesn't start itself again under the message
    setOpen(null);
  };

  /** The agent's chat, once it has one (its hello starts it). */
  const chatOf = async (): Promise<string | null> => {
    for (let i = 0; i < 8 && alive.current; i++) {
      await useStore.getState().refreshChannels().catch(() => {});
      const id = useStore.getState().channels.find((c) => c.kind === "dm" && c.name.endsWith(`:${agentId}`))?.id ?? null;
      if (id) return id;
      await wait(1000);
    }
    return null;
  };

  /** Point the agent at this AI, then wait until it has answered; only then does its chat open. */
  const tryIt = async (h: string, connectionId: string | null) => {
    if (!device) return fail("Waiting for a computer to connect.");
    const n = ++run.current;
    const live = () => alive.current && run.current === n;
    setHarness(h);
    setPhase("checking");
    setStage("signin");
    setProblem(null);
    setResign(null);
    setLast(() => () => void tryIt(h, connectionId));
    hostReact("nod");
    try {
      const st = useStore.getState();
      const a = st.agents.find((x) => x.id === agentId);
      if (!a) throw new Error(`${name} is gone. Go back and make it again.`);
      await pointAgentAt(a, device, h, connectionId, st.computers);
      await Promise.allSettled([st.refreshAgents(), st.refreshComputers()]);
      const r = await checkAI({ agentId, harness: h, connectionId, deviceName: device.name }, live, (s) => live() && setStage(s));
      if (!r || !live()) return;
      if (!r.ok) return fail(r.problem, r.resign);
      hostReact("hop");
      setStage("opening");
      const channelId = await chatOf();
      if (live()) onDone(channelId);
    } catch (e) {
      if (live()) fail(unavailable(e, harnessLabel(h)));
    }
  };

  const takeFound = async () => {
    if (!found || !device) return;
    if (!found.share) return void tryIt(found.harness, found.connectionId);
    setPhase("checking");
    setHarness(found.harness);
    try {
      const c = await api<ModelConnection>("POST", "/api/model-connections/import", { provider: signInProvider(found.harness), nodeId: device.id });
      reload();
      void tryIt(found.harness, c.id);
    } catch {
      // can't share it: use it where it is
      void tryIt(found.harness, null);
    }
  };

  const pick = (o: Open) => {
    run.current++;
    setOpen(o);
    setPhase("idle");
    setProblem(null);
  };

  /** A harness that keeps its sign-in where it runs: install it, then its own sign-in. */
  const deviceHarness = async (id: string) => {
    run.current++;
    setProblem(null);
    setLast(() => () => void deviceHarness(id));
    if (!device) return fail("Waiting for a computer to connect.");
    const signedIn = device.harnesses?.find((x) => x.id === id)?.accounts?.default === true;
    if (signedIn) return void tryIt(id, null);
    try {
      if (!device.harnesses?.some((x) => x.id === id)) {
        setPhase("checking");
        setStage("install");
        setHarness(id);
        await api("POST", `/api/nodes/${device.id}/install`, { harness: id });
        await api("POST", `/api/nodes/${device.id}/refresh`).catch(() => {});
        setPhase("idle");
      }
      const r = await api<HarnessesResponse>("GET", `/api/nodes/${device.id}/harness-settings?harness=${encodeURIComponent(id)}`);
      const s = r.harnesses.find((h) => h.harness === id);
      if (!s) throw new Error(`${harnessLabel(id)} isn't on ${device.name} yet`);
      const { HarnessSignIn } = await import("../settings/harnesses.tsx");
      setDialog({ Dialog: HarnessSignIn, device: r.device, settings: s });
    } catch (e) {
      fail(unavailable(e, harnessLabel(id)));
    }
  };

  /** A key or sign-in from "API key": which harness runs it depends on whose it is. */
  const connected = async (connectionId: string | null) => {
    reload();
    const all = await api<{ connections: ModelConnection[] }>("GET", "/api/model-connections").catch(() => null);
    const c = connectionId ? all?.connections.find((x) => x.id === connectionId) : undefined;
    if (c) return void tryIt(harnessFor(c.provider, c.kind, support), c.id);
    // it said done without naming the connection: use whatever is ready now
    const ready = foundOn(device, all?.connections ?? []);
    if (ready) return void tryIt(ready.harness, ready.connectionId);
    fail("That didn't connect. Try again.");
  };

  /** Sign in again where this AI signs in: Claude and ChatGPT through Bubble AI, the rest on the computer. */
  const signInAgain = (h: string) => (h === "claude-code" ? pick("claude") : h === "codex" ? pick("chatgpt") : void deviceHarness(h));

  /** "Set up later": the agent stays as it is and says hello anyway (the hub's plain one, saying what it still needs). */
  const later = async () => {
    run.current++;
    setLeaving(true);
    setProblem(null);
    setPhase("checking");
    setStage("opening");
    await api("POST", `/api/agents/${agentId}/greet`).catch(() => {});
    const channelId = await chatOf();
    if (alive.current) onDone(channelId);
  };

  const others = HARNESSES.filter((h) => h.protocol !== "mcp" && !ROWS.some((r) => r.harness === h.id));
  const signedInOn = (id: string) => device?.harnesses?.find((x) => x.id === id)?.accounts?.default === true;
  const row = ROWS.find((r) => r.id === open);
  const checking = phase === "checking";
  const back = open && !checking ? () => pick(open === "key" ? "else" : null) : onBack;

  return (
    <SetupShell
      at={3}
      onBack={checking || leaving ? null : back}
      foot={
        leaving ? undefined : checking || open === "else" ? (
          // also while it's being tried (that can take minutes): nobody waits here unless they want to
          <SetupLink onClick={() => void later()}>Set up later</SetupLink>
        ) : open ? undefined : (
          <>
            <SetupLink onClick={() => pick("else")}>Something else</SetupLink>
            {/* a sign-in that failed never ends setup by itself: this is the way on without it */}
            {phase === "failed" && <SetupLink onClick={() => void later()}>Set up later</SetupLink>}
          </>
        )
      }
    >
      <HostGhost look={agent?.settings.appearance ?? HOST_LOOK} size={56} mood={checking ? "working" : "awake"} />
      <SetupTitle>What should {name} think with?</SetupTitle>
      <p className="text-muted pb-2">Sign in once. Every agent can use it.</p>

      {checking && (
        <p className="flex items-center gap-2.5" role="status">
          <Loader2 size={16} className="animate-spin text-muted" aria-hidden />
          {stage === "install" ? `Installing ${harnessLabel(harness)}` : stage === "signin" ? `Signing in to ${harnessLabel(harness)}` : stage === "hello" ? `${name} is saying hello` : "Opening"}
        </p>
      )}

      {phase === "failed" && (
        <div className="flex flex-col items-start gap-2 pb-1">
          <SetupProblem>{problem ?? "That didn't work."}</SetupProblem>
          <button type="button" className="h-9 px-4 rounded-full border border-line2 text-[13px] font-medium hover:bg-hover" onClick={() => (resign ? signInAgain(resign) : last ? last() : pick(null))}>
            {resign ? "Sign in again" : "Try again"}
          </button>
        </div>
      )}

      {!checking && !open && (
        <Card>
          {/* another AI already signed in on the person's computer goes first */}
          {found && !ROWS.some((r) => r.harness === found.harness) && (
            <Line onClick={() => void takeFound()} logo={found.harness} word="Signed in">
              {harnessLabel(found.harness)}
            </Line>
          )}
          {ROWS.map((r) => {
            const here = found && found.harness === r.harness;
            return (
              <Line key={r.id} onClick={() => (here ? void takeFound() : pick(r.id))} word={here ? "Signed in" : undefined}>
                {MODEL_PROVIDER_INFO[r.provider].label}
              </Line>
            );
          })}
        </Card>
      )}

      {!checking && row && (
        <Panel title={MODEL_PROVIDER_INFO[row.provider].label}>
          {/* Claude's sign-in runs `claude setup-token` in a terminal on the device, which Windows can't do yet */}
          {row.id === "claude" && device?.capabilities?.platform === "win32" && <p className="text-[13px] leading-5 text-muted">Not on Windows yet. Use an API key.</p>}
          <ConnectModel key={row.provider} provider={row.provider} onDone={(cid) => (reload(), void tryIt(row.harness, cid))} />
        </Panel>
      )}

      {!checking && open === "key" && (
        <Panel title="API key">
          <ConnectModel onDone={(cid) => void connected(cid)} />
        </Panel>
      )}

      {!checking && open === "else" && (
        <Card>
          <Line onClick={() => pick("key")}>API key</Line>
          {others.map((h) => (
            <Line key={h.id} onClick={() => void deviceHarness(h.id)} logo={h.id} word={found?.harness === h.id || signedInOn(h.id) ? "Signed in" : undefined}>
              {h.label}
            </Line>
          ))}
        </Card>
      )}

      {!device && !checking && (
        <p className="text-[13px] text-muted" role="status">
          Waiting for a computer to connect
        </p>
      )}

      {dialog && (
        <dialog.Dialog
          device={dialog.device}
          settings={dialog.settings}
          account={dialog.settings.accounts.find((a) => a.isDefault) ?? dialog.settings.accounts[0]}
          onClose={() => setDialog(null)}
          onDone={() => {
            const id = dialog.settings.harness;
            setDialog(null);
            void tryIt(id, null);
          }}
        />
      )}
    </SetupShell>
  );
}

/** A grouped list of rows on a card. */
function Card({ children }: { children: ReactNode }) {
  return <div className="shrink-0 rounded-[14px] bg-card overflow-hidden divide-y divide-line">{children}</div>;
}

/** One thing to pick: its name, and a chevron or one status word. */
function Line({ children, onClick, word, logo }: { children: ReactNode; onClick: () => void; word?: string; logo?: string }) {
  return (
    <button type="button" onClick={onClick} className="w-full min-h-12 px-4 flex items-center gap-3 text-left hover:bg-hover outline-none focus-visible:bg-hover">
      {logo && (
        <span className="shrink-0 size-[18px] grid place-items-center" aria-hidden>
          <HarnessLogo harness={logo} size={18} />
        </span>
      )}
      <span className="flex-1 min-w-0 truncate text-[15px] font-semibold">{children}</span>
      {word ? <span className="text-[13px] text-muted">{word}</span> : <ChevronRight size={15} className="text-muted" aria-hidden />}
    </button>
  );
}

/** One choice opened in place: its name, then its sign-in. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}
