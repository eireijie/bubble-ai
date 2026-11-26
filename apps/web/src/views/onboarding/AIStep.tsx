import { useEffect, useRef, useState, type ComponentType } from "react";
import { Check, Loader2 } from "lucide-react";
import { HARNESSES, MODEL_PROVIDER_INFO, harnessLabel, type HarnessSettings, type ModelConnection, type ModelProvider } from "@bubble-ai/core";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { unavailable } from "../../join.ts";
import { ConnectModel } from "../../components/ConnectModel.tsx";
import { HarnessLogo } from "../../components/HarnessLogo.tsx";
import { SetupProblem } from "../../components/SetupShell.tsx";
import { BubbleSlot } from "./Stage.tsx";
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
export type Found = { harness: string; connectionId: string | null; share?: boolean };
/** With `only`, just that harness: each AI row says "Signed in" for its own sign-in, not only the best one. */
export function foundOn(device: DeviceInfo | undefined, connections: ModelConnection[], only?: string): Found | null {
  const wanted = (h: string) => !only || only === h;
  for (const h of ["claude-code", "codex"]) {
    const c = wanted(h) ? readyConnection(h, connections) : undefined;
    if (c) return { harness: h, connectionId: c.id };
  }
  const signedIn = (id: string) => wanted(id) && device?.harnesses?.find((x) => x.id === id)?.accounts?.default === true;
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

/** The three apps most people already use, shown big; Hermes runs any of the big model companies. */
const FEATURED: { harness: string; sub: string; provider?: ModelProvider }[] = [
  { harness: "claude-code", sub: "Claude", provider: "anthropic" },
  { harness: "codex", sub: "ChatGPT", provider: "openai" },
  { harness: "hermes", sub: "Claude, ChatGPT, Grok, Gemini" },
];
/** What Hermes can think with: each is a sign-in or a key Bubble AI keeps. */
const HERMES_MODELS: ModelProvider[] = ["anthropic", "openai", "xai", "google", "openrouter"];
type Phase = "idle" | "checking" | "failed";

/**
 * "Which AI app runs it?": every app an agent can run on, all at once, each with its own logo; the
 * three most people use are big. Picking one opens what it needs right under it: Claude Code and
 * Codex sign in through Bubble AI (or use the sign-in already on the computer), Hermes picks which
 * company's model it thinks with, the rest install and sign in on the computer. Then the agent is
 * pointed at it and its chat opens only once it has really answered. A failure says why in one line
 * and stays here. "Set up later" goes on without it.
 */
export function AIStep({ agentId, device, onDone, onBusy }: { agentId: string; device: DeviceInfo | undefined; onDone: (channelId: string | null) => void; onBack?: () => void; onBusy?: (busy: boolean) => void }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === agentId));
  const { connections, support, reload } = useConnections();
  const found = foundOn(device, connections ?? []);
  const [sel, setSel] = useState<string | null>(null);
  const [model, setModel] = useState<ModelProvider>("anthropic");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stage, setStage] = useState<"install" | "signin" | "hello" | "opening">("signin");
  const [harness, setHarness] = useState(found?.harness ?? "claude-code");
  const [problem, setProblem] = useState<string | null>(null);
  // its AI said "signed in" but its first run couldn't sign in (an expired session): sign in again
  const [resign, setResign] = useState<string | null>(null);
  // what failed, to try again
  const [last, setLast] = useState<(() => void) | null>(null);
  const [leaving, setLeaving] = useState(false);
  // installed here a moment ago, before the device list has caught up
  const [justInstalled, setJustInstalled] = useState<string[]>([]);
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
  const checking = phase === "checking";
  useEffect(() => onBusy?.(checking), [checking]); // eslint-disable-line react-hooks/exhaustive-deps
  // leaving this page (its chat opened, or Set up later) is never left looking busy
  useEffect(() => () => onBusy?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (text: string, re?: string) => {
    setResign(re ?? null);
    setProblem(text);
    setPhase("failed");
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
    try {
      const st = useStore.getState();
      const a = st.agents.find((x) => x.id === agentId);
      if (!a) throw new Error(`${name} is gone. Go back and make it again.`);
      await pointAgentAt(a, device, h, connectionId, st.computers);
      await Promise.allSettled([st.refreshAgents(), st.refreshComputers()]);
      const r = await checkAI({ agentId, harness: h, connectionId, deviceName: device.name }, live, (s) => live() && setStage(s));
      if (!r || !live()) return;
      if (!r.ok) return fail(r.problem, r.resign);
      setStage("opening");
      const channelId = await chatOf();
      if (live()) onDone(channelId);
    } catch (e) {
      if (live()) fail(unavailable(e, harnessLabel(h)));
    }
  };

  const takeFound = async (found: Found | null) => {
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

  const pick = (h: string) => {
    if (checking) return;
    run.current++;
    setSel((s) => (s === h ? null : h));
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

  /** Install a harness on this computer, with progress, and stay on the page (its sign-in comes next). */
  const install = async (id: string) => {
    run.current++;
    setProblem(null);
    setLast(() => () => void install(id));
    if (!device) return fail("Waiting for a computer to connect.");
    setPhase("checking");
    setStage("install");
    setHarness(id);
    try {
      await api("POST", `/api/nodes/${device.id}/install`, { harness: id });
      await api("POST", `/api/nodes/${device.id}/refresh`).catch(() => {});
      setJustInstalled((s) => [...s, id]);
      setPhase("idle");
    } catch (e) {
      fail(unavailable(e, harnessLabel(id)));
    }
  };

  /** A key or sign-in made on Hermes's model picker: Hermes runs it unless it can't. */
  const connected = async (connectionId: string | null, h: string) => {
    reload();
    const all = await api<{ connections: ModelConnection[] }>("GET", "/api/model-connections").catch(() => null);
    const c = connectionId ? all?.connections.find((x) => x.id === connectionId) : undefined;
    if (c) return void tryIt(canUse(support, h, { provider: c.provider, kind: c.kind }) ? h : harnessFor(c.provider, c.kind, support), c.id);
    const ready = foundOn(device, all?.connections ?? []);
    if (ready) return void tryIt(ready.harness, ready.connectionId);
    fail("That didn't connect. Try again.");
  };

  /** Sign in again where this AI signs in: Claude and ChatGPT through Bubble AI, the rest on the computer. */
  const signInAgain = (h: string) => (h === "claude-code" || h === "codex" || h === "hermes" ? (setSel(h), setPhase("idle"), setProblem(null)) : void deviceHarness(h));

  /** "Set up later": the agent stays as it is and says hello anyway (the hub's plain one, saying what it still needs). */
  const later = async () => {
    run.current++;
    setLeaving(true);
    setProblem(null);
    setPhase("checking");
    setStage("opening");
    // it stays unfinished, but on this computer and on an AI app that's really here (signed in first),
    // not "Claude Code, no device yet"
    if (device) {
      const a = useStore.getState().agents.find((x) => x.id === agentId);
      const ready = foundOn(device, connections ?? []);
      const here = HARNESSES.find((h) => h.protocol !== "mcp" && device.harnesses?.some((x) => x.id === h.id))?.id;
      const harness = ready?.harness ?? here ?? a?.harness;
      const patch = { ...(harness && harness !== a?.harness ? { harness } : {}), ...(a && !a.nodeId ? { nodeId: device.id } : {}), ...(ready?.connectionId ? { settings: { connectionId: ready.connectionId } } : {}) };
      if (Object.keys(patch).length) await api("PATCH", `/api/agents/${agentId}`, patch).catch(() => {});
      await useStore.getState().refreshAgents().catch(() => {});
    }
    await api("POST", `/api/agents/${agentId}/greet`).catch(() => {});
    const channelId = await chatOf();
    if (alive.current) onDone(channelId);
  };

  const rest = HARNESSES.filter((h) => h.protocol !== "mcp" && !FEATURED.some((f) => f.harness === h.id));
  const signedIn = (id: string) => !!foundOn(device, connections ?? [], id);
  const feat = FEATURED.find((f) => f.harness === sel);
  const installed = (id: string) => justInstalled.includes(id) || !!device?.harnesses?.some((x) => x.id === id);

  return (
    <div className="flex w-full max-w-[640px] flex-col items-center">
      <BubbleSlot size={72} />
      <h1 className="ob-title mt-4">Which AI app runs {name}?</h1>
      <div role="radiogroup" aria-label="AI app" className="mt-7 grid w-full grid-cols-3 gap-2">
        {FEATURED.map((f) => (
          <button key={f.harness} type="button" role="radio" aria-checked={sel === f.harness} aria-label={`${harnessLabel(f.harness)}, runs ${f.sub}${signedIn(f.harness) ? ", signed in" : ""}`} disabled={checking && harness !== f.harness} onClick={() => pick(f.harness)} className="ob-tile flex min-h-[104px] flex-col items-start gap-2.5 p-3.5 disabled:opacity-40">
            <HarnessLogo harness={f.harness} size={28} />
            <span>
              <span className="block text-[15px] font-semibold">{harnessLabel(f.harness)}</span>
              <span className="block text-[12.5px] leading-4 text-muted">{f.sub}</span>
            </span>
            {signedIn(f.harness) && <SignedDot />}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="More AI apps" className="mt-2 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {rest.map((h) => (
          <button key={h.id} type="button" role="radio" aria-checked={sel === h.id} aria-label={`${h.label}${signedIn(h.id) ? ", signed in" : ""}`} disabled={checking && harness !== h.id} onClick={() => pick(h.id)} className="ob-tile flex h-11 items-center gap-2.5 px-3 disabled:opacity-40">
            <HarnessLogo harness={h.id} size={18} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{h.label}</span>
            {signedIn(h.id) && <SignedDot />}
          </button>
        ))}
      </div>

      {/* what the picked app needs, opened right under the apps */}
      <div className="mt-5 w-full">
        {checking ? (
          <p className="ob-panel flex items-center justify-center gap-2.5 text-[14px]" role="status">
            <Loader2 size={16} className="animate-spin text-muted" aria-hidden />
            {stage === "install" ? `Installing ${harnessLabel(harness)}` : stage === "signin" ? `Signing in to ${harnessLabel(harness)}` : stage === "hello" ? `${name} is saying hello` : "Opening"}
          </p>
        ) : phase === "failed" ? (
          <div className="ob-panel flex flex-col items-center gap-2.5 text-center">
            <SetupProblem>{problem ?? "That didn't work."}</SetupProblem>
            <button type="button" className="h-8 rounded-lg px-3.5 text-[13.5px] font-medium shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover" onClick={() => (resign ? signInAgain(resign) : last ? last() : setPhase("idle"))}>
              {resign ? "Sign in again" : "Try again"}
            </button>
          </div>
        ) : sel ? (
          <section key={sel} className="ob-panel rounded-xl bg-card p-4" aria-label={harnessLabel(sel)}>
            {sel === "hermes" ? (
              <div className="flex flex-col gap-3">
                <div role="radiogroup" aria-label="Model" className="ob-seg flex-wrap">
                  {HERMES_MODELS.map((p) => (
                    <button key={p} type="button" role="radio" aria-checked={model === p} onClick={() => setModel(p)}>
                      {MODEL_PROVIDER_INFO[p].label}
                    </button>
                  ))}
                </div>
                <ConnectModel key={model} provider={model} onDone={(cid) => void connected(cid, "hermes")} />
              </div>
            ) : feat?.provider ? (
              signedIn(sel) ? (
                <UseIt label={harnessLabel(sel)} onClick={() => void takeFound(foundOn(device, connections ?? [], sel))} />
              ) : device && !installed(sel) ? (
                // its sign-in runs on a computer that has it: install it here first
                <UseIt label={harnessLabel(sel)} verb="Install" where={device.name} note="Not on" onClick={() => void install(sel)} />
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Claude's sign-in runs `claude setup-token` in a terminal on the device, which Windows can't do yet */}
                  {sel === "claude-code" && device?.capabilities?.platform === "win32" && <p className="text-[13px] leading-5 text-muted">Not on Windows yet. Use an API key.</p>}
                  <ConnectModel key={feat.provider} provider={feat.provider} onDone={(cid) => (reload(), void tryIt(sel, cid))} />
                </div>
              )
            ) : (
              <UseIt label={harnessLabel(sel)} verb={signedIn(sel) ? "Use" : "Set up"} where={signedIn(sel) ? undefined : device?.name} onClick={() => void deviceHarness(sel)} />
            )}
          </section>
        ) : null}
      </div>

      {!device && !checking && (
        <p className="mt-3 text-[13px] text-muted" role="status">
          Waiting for a computer to connect
        </p>
      )}
      {!leaving && (
        <button type="button" onClick={() => void later()} className="ob-quiet mt-6">
          Set up later
        </button>
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
    </div>
  );
}

/** Signed in already, on a tile's corner. */
function SignedDot() {
  return (
    <span className="absolute right-2.5 top-2.5 grid size-[16px] place-items-center rounded-full bg-ok text-white" title="Signed in" aria-label="Signed in">
      <Check size={10} strokeWidth={3.4} aria-hidden />
    </span>
  );
}

/** One button for an app that's ready or installs on the computer. */
function UseIt({ label, verb = "Use", where, note, onClick }: { label: string; verb?: string; where?: string; note?: string; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13.5px] text-muted">{where ? `${note ?? "Installs and signs in on"} ${where}` : "Signed in"}</span>
      <button type="button" onClick={onClick} className="ob-primary h-9 px-4">
        {verb} {label}
      </button>
    </div>
  );
}
