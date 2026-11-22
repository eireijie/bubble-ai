import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { catalogConnector, type AppleView, type Connector, type SignInOption } from "@wisp/core";
import { connectApps, signInOptions } from "../../appSignIn.ts";
import { api, ApiError } from "../../api.ts";
import { useStore } from "../../store.ts";
import { setFeatures, useFeature } from "../../features.ts";
import { useDevices } from "../../devices.ts";
import { loadAnswers, saveAnswers } from "../../onboardingV3.ts";
import { PageTop } from "../../components/onboarding/PageTop.tsx";
import { HOST_LOOK, HostGhost, hostAnswer, hostReact } from "../../components/onboarding/HostGhost.tsx";
import { useNarrow } from "../../components/SetupShell.tsx";
import { AGENT_TYPES, APPLE_PERMISSION, appsForTypes, missesMac, type StartApp } from "./agentTypes.ts";

/** How a row connects from here: the hub says which apps sign in from this address (see signInOptions). */
export type RowMode = "mac" | "signin" | "key" | "soon" | "loading";
export function rowMode(app: StartApp, options: Record<string, SignInOption> | null): RowMode {
  if (app.how === "mac" || app.how === "soon") return app.how;
  const entry = app.catalogId ? catalogConnector(app.catalogId) : undefined;
  if (!entry) return "soon";
  if (entry.signIn && !options) return "loading";
  const o = options?.[entry.id];
  if (o?.signIn) return "signin";
  return entry.fields.some((f) => !f.optional) && (o?.key ?? true) ? "key" : "soon";
}

/**
 * The rows one sign-in covers: Gmail, Google Calendar and Drive share one Google sign-in, so
 * signing in to one connects the others in the sheet that aren't connected yet.
 */
export function signInGroup(app: StartApp, apps: StartApp[], modes: Record<string, RowMode>, done: (id: string) => boolean): StartApp[] {
  const s = catalogConnector(app.catalogId!)?.signIn;
  if (s?.via !== "app") return [app];
  return [app, ...apps.filter((a) => a.id !== app.id && modes[a.id] === "signin" && !done(a.id) && (() => {
    const o = catalogConnector(a.catalogId!)?.signIn;
    return o?.via === "app" && o.provider === s.provider;
  })())].slice(0, 5);
}

/** Where an app's setup stands in the sheet. */
type RowState = { phase: "idle" | "key" | "busy" | "done" | "failed"; error?: string; /** false: saved, but Wisp has no way to try the key */ checked?: boolean };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Does Wisp live on a Mac here (one of your own devices is a Mac)? Apple apps are read there. */
export function onAMac(devices: readonly { mine?: boolean; capabilities?: { platform?: string } | null }[] | null): boolean {
  return !!devices?.some((d) => d.mine && d.capabilities?.platform === "darwin");
}

/** "Continue with 2 apps" / "Connect one to continue" */
export const sheetCta = (n: number) => (n ? `Continue with ${n} ${n === 1 ? "app" : "apps"}` : "Connect one to continue");

/**
 * First-run page 1, right after the account: "What should your first agent do?" More than one
 * kind can be picked; each brings the apps it starts with, merged into one sheet where every app
 * is one row with one button. The agent reads them once, before its hello, and changes nothing
 * without a yes. Skipping is always there, and the hello works with nothing connected.
 */
export function TypeStep({ workspaceId, onContinue, onBack }: { workspaceId: string; onContinue: () => void; onBack?: () => void }) {
  const saved = loadAnswers(workspaceId);
  const [types, setTypes] = useState<string[]>(saved.agentTypes ?? []);
  const [other, setOther] = useState(saved.agentOther ?? "");
  const [sheet, setSheet] = useState(false);
  const devices = useDevices(5000);
  const mac = onAMac(devices);
  const apps = appsForTypes(types, other, mac);
  const ready = apps.filter((a) => a.how !== "soon");
  const [picked, setPicked] = useState<string | null>(null);

  const toggle = (id: string) => {
    setTypes((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
    setPicked(id);
    hostAnswer("nod");
  };
  const save = (extra: Partial<Parameters<typeof saveAnswers>[1]> = {}) => saveAnswers(workspaceId, { agentTypes: types, agentOther: other.trim(), typeDone: true, ...extra });
  const skip = () => (save({ agentTypes: [], agentOther: "" }), onContinue());
  const next = () => {
    if (ready.length) return setSheet(true);
    save();
    onContinue();
  };

  const names = AGENT_TYPES.filter((t) => types.includes(t.id) && t.id !== "other").map((t) => t.name);
  if (types.includes("other") && other.trim()) names.push(other.trim());
  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-panel text-ink text-[14px] leading-[22px]">
      <PageTop step={1} onBack={onBack} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="min-h-full grid grid-cols-1 lg:grid-cols-[minmax(0,560px)_minmax(0,400px)] gap-8 lg:gap-20 justify-center items-center px-4 sm:px-6 pt-4 pb-10">
          <form
            className="flex flex-col gap-[22px] min-w-0 order-2 lg:order-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (types.length) next();
            }}
          >
            <div className="flex flex-col gap-0.5">
              <h1 className="text-[24px] leading-[30px] font-[650] tracking-[-0.015em]">What should your first agent do?</h1>
              <p className="text-[15px] leading-[22px] text-muted">Pick one or more. I'll set up the apps it needs.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Kind of agent">
              {AGENT_TYPES.map((t) => {
                const on = types.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(t.id)}
                    className={`ob-btn flex items-start gap-3 rounded-[14px] border bg-panel px-3.5 py-3 text-left ${on && picked === t.id ? "ob-settle" : ""}`}
                    style={{ borderColor: on ? "var(--ink)" : "var(--line2)", boxShadow: on ? "inset 0 0 0 1px var(--ink)" : "none" }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-[1px] shrink-0">
                      <path d={t.icon} />
                    </svg>
                    <span className="flex-1 min-w-0">
                      <strong className="block text-[14px] font-semibold">{t.name}</strong>
                      <span className="block text-[13px] leading-[18px] text-muted">{t.sub}</span>
                    </span>
                    <span aria-hidden className="mt-[2px] size-[18px] shrink-0 rounded-full border flex items-center justify-center" style={{ borderColor: on ? "var(--ink)" : "var(--line2)", background: on ? "var(--ink)" : "transparent" }}>
                      {on && <Check size={12} strokeWidth={2.4} className="text-panel" />}
                    </span>
                  </button>
                );
              })}
            </div>
            {types.includes("other") && (
              <input
                autoFocus
                value={other}
                maxLength={200}
                onChange={(e) => setOther(e.target.value)}
                placeholder="In your words, e.g. plan my garden"
                aria-label="What it should do, in your words"
                className="h-11 box-border px-[18px] rounded-full border border-[var(--input)] bg-[var(--control)] text-ink text-[15px] outline-none focus:border-ink w-full min-w-0"
              />
            )}
            <div className="flex gap-2 items-center pt-1">
              <button type="submit" disabled={!types.length} className="ob-btn setup-press h-11 px-[22px] rounded-full bg-ink text-panel font-semibold disabled:opacity-40">
                {ready.length ? "Set up apps" : "Continue"}
              </button>
              <button type="button" onClick={skip} className="ob-btn h-11 px-4 rounded-full text-muted hover:text-ink">
                Skip for now
              </button>
            </div>
          </form>
          <div className="flex flex-col items-center gap-3 min-w-0 order-1 lg:order-2">
            <div className="w-full max-w-[400px] h-[200px] lg:h-[300px] rounded-[24px] bg-[var(--card)] flex flex-col items-center justify-center gap-3">
              <HostGhost look={HOST_LOOK} size={130} />
              <span className="text-[13px] text-muted text-center px-6 line-clamp-2" aria-live="polite">
                {names.length ? names.join(" · ") : "Pick what I'll help with."}
              </span>
            </div>
          </div>
        </div>
      </div>
      {sheet && (
        <AppsSheet
          workspaceId={workspaceId}
          apps={apps}
          macMissing={missesMac(types, mac)}
          onClose={() => setSheet(false)}
          onDone={(connectorIds, appleApps, appNames) => {
            save({ apps: connectorIds, appleApps, appNames });
            setSheet(false);
            onContinue();
          }}
        />
      )}
    </div>
  );
}

/**
 * The apps for the picked kinds, one row each with one button: Allow (an Apple app, macOS asks
 * once), Add key (a connector; the key goes to Wisp, never shown again), or a greyed "Soon".
 */
export function AppsSheet({ workspaceId, apps, macMissing, onClose, onDone }: { workspaceId: string; apps: StartApp[]; macMissing: boolean; onClose: () => void; onDone: (connectorIds: string[], appleApps: string[], appNames: string[]) => void }) {
  const narrow = useNarrow("(max-width: 639px)");
  const devices = useDevices(10_000);
  const isOwner = useStore((s) => s.me?.role === "owner");
  const appleOn = useFeature("apple");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  // which apps sign in from here (asked once; on failure every app falls back to its key)
  const [options, setOptions] = useState<Record<string, SignInOption> | null>(null);
  useEffect(() => void signInOptions().then(setOptions, () => setOptions({})), []);
  const modes = Object.fromEntries(apps.map((a) => [a.id, rowMode(a, options)])) as Record<string, RowMode>;
  // apps that can't connect from here go last, as Soon
  const shown = [...apps].sort((a, b) => Number(modes[a.id] === "soon") - Number(modes[b.id] === "soon"));
  // what was connected: catalog connectors by app id, Apple apps by name
  const made = useRef<Record<string, string>>({});
  const prior = loadAnswers(workspaceId);
  // apps connected on an earlier visit to this sheet stay connected
  useEffect(() => {
    const done: Record<string, RowState> = {};
    for (const a of apps) if (a.apple ? prior.appleApps?.includes(a.apple) : false) done[a.id] = { phase: "done" };
    if (!prior.apps?.length) return setRows((r) => ({ ...done, ...r }));
    void api<Connector[]>("GET", "/api/connectors").then((list) => {
      for (const a of apps) {
        const c = list.find((x) => prior.apps!.includes(x.id) && x.catalogId === a.catalogId);
        if (c) ((made.current[a.id] = c.id), (done[a.id] = { phase: "done" }));
      }
      setRows((r) => ({ ...done, ...r }));
    }, () => setRows((r) => ({ ...done, ...r })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (id: string, s: RowState) => setRows((r) => ({ ...r, [id]: s }));
  const doneIds = apps.filter((a) => rows[a.id]?.phase === "done").map((a) => a.id);

  const allow = async (a: StartApp) => {
    set(a.id, { phase: "busy" });
    try {
      // the Apple mod is off until added: allowing an app here adds it, reading only that app
      const fresh = !appleOn;
      if (fresh) {
        if (!isOwner) throw new Error("Only your Wisp's owner can turn on the Apple apps.");
        await setFeatures({ apple: true });
      }
      const view = await api<AppleView>("GET", "/api/apple");
      const mine = new Set((devices ?? []).filter((d) => d.mine).map((d) => d.id));
      const mac = view.macs.find((m) => m.online && mine.has(m.nodeId)) ?? view.macs.find((m) => m.online);
      if (!mac) throw new Error("Wisp can't reach your Mac right now. Open Wisp on it, then try again.");
      const levels = fresh ? { messages: 0, contacts: 0, calendar: 0, reminders: 0, [a.apple!]: 1 } : { [a.apple!]: 1 };
      await api("PUT", "/api/apple/settings", { macNodeId: mac.nodeId, levels });
      const perm = APPLE_PERMISSION[a.apple!];
      const status = () => api<AppleView>("GET", "/api/apple").then((v) => v.macs.find((m) => m.nodeId === mac.nodeId)?.status?.[perm.status]);
      if ((await status()) !== "allowed") {
        // macOS shows its own prompt on the Mac (or its System Settings pane for Full Disk Access)
        void api("POST", "/api/apple/mac/permission", { pane: perm.pane }).catch(() => undefined);
        const until = Date.now() + 120_000;
        for (;;) {
          await wait(1500);
          await api("POST", "/api/apple/mac/refresh").catch(() => undefined);
          const s = await status();
          if (s === "allowed") break;
          if (s === "denied" && perm.pane !== "fullDiskAccess") throw new Error(`macOS said no. Allow Wisp in System Settings › Privacy & Security › ${a.name}, then try again.`);
          if (Date.now() > until) throw new Error(perm.pane === "fullDiskAccess" ? "Turn on Wisp in System Settings › Privacy & Security › Full Disk Access, then try again." : "macOS didn't answer. Try again.");
        }
      }
      const next = [...new Set([...(loadAnswers(workspaceId).appleApps ?? []), a.apple!])];
      saveAnswers(workspaceId, { appleApps: next });
      set(a.id, { phase: "done" });
      hostReact("catch");
    } catch (e) {
      set(a.id, { phase: "failed", error: (e as Error).message });
    }
  };

  const addKey = async (a: StartApp) => {
    const entry = catalogConnector(a.catalogId!);
    if (!entry) return set(a.id, { phase: "failed", error: `${a.name} isn't in this Wisp's catalog.` });
    const env = Object.fromEntries(Object.entries(values[a.id] ?? {}).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const missing = entry.fields.filter((f) => !f.optional && !env[f.key]).map((f) => f.label);
    if (missing.length) return set(a.id, { phase: "key", error: `Add the ${missing.join(" and ").toLowerCase()}.` });
    set(a.id, { phase: "busy" });
    let created: string | null = null;
    try {
      const body: Record<string, unknown> = { kind: entry.kind, name: entry.name, catalogId: entry.id, env, agentIds: [] };
      if (entry.kind === "mcp-stdio") Object.assign(body, { command: entry.command, args: entry.args ?? [] });
      if (entry.kind === "mcp-http") Object.assign(body, { url: entry.url, headers: entry.headers ?? {} });
      let id: string;
      try {
        id = (await api<Connector>("POST", "/api/connectors", body)).id;
        created = id;
      } catch (e) {
        // already connected under this name: give it the new key
        if (!(e instanceof ApiError) || e.status !== 409) throw e;
        const have = (await api<Connector[]>("GET", "/api/connectors")).find((c) => c.name === entry.name);
        if (!have) throw e;
        id = (await api<Connector>("PATCH", `/api/connectors/${have.id}`, { env })).id;
      }
      // one read to check the key works (only for apps Wisp can read itself)
      const check = await api<{ ok: boolean; checked?: boolean; error?: string }>("POST", `/api/connectors/${id}/check`).catch(() => ({ ok: true, checked: false }) as { ok: boolean; checked?: boolean; error?: string });
      if (!check.ok) {
        if (created) await api("DELETE", `/api/connectors/${created}`).catch(() => undefined);
        throw new Error(check.error ?? `${a.name} didn't accept that key.`);
      }
      made.current[a.id] = id;
      setValues((v) => ({ ...v, [a.id]: {} }));
      set(a.id, { phase: "done", checked: check.checked !== false });
      hostReact("catch");
    } catch (e) {
      set(a.id, { phase: "key", error: (e as Error).message });
    }
  };

  const signIn = async (a: StartApp) => {
    const group = signInGroup(a, apps, modes, (id) => rows[id]?.phase === "done");
    for (const g of group) set(g.id, { phase: "busy" });
    // agents get them when onboarding makes the first one (see onDone), like keys added here
    const r = await connectApps(group.map((g) => g.catalogId!), { agentIds: [] });
    for (const g of group) {
      const c = r.connectors.find((x) => x.catalogId === g.catalogId);
      if (r.ok && c) {
        made.current[g.id] = c.id;
        set(g.id, { phase: "done" });
      } else set(g.id, { phase: "failed", error: r.ok ? `${g.name} didn't connect. Try again.` : r.error });
    }
    if (r.ok) hostReact("catch");
  };

  const finish = () => {
    const ids = apps.filter((a) => rows[a.id]?.phase === "done" && made.current[a.id]).map((a) => made.current[a.id]);
    const apple = apps.filter((a) => rows[a.id]?.phase === "done" && a.apple).map((a) => a.apple!);
    onDone(ids, apple, apps.filter((a) => rows[a.id]?.phase === "done" && made.current[a.id]).map((a) => a.name));
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 ob-fade" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ob-apps-title"
        className={`ob-sheet flex flex-col bg-panel text-ink shadow-[var(--shadow)] ${narrow ? "w-full max-h-[88vh] rounded-t-[20px]" : "w-[560px] max-h-[82vh] rounded-[20px]"}`}
      >
        <div className="px-5 pt-5 pb-3">
          <h2 id="ob-apps-title" className="text-[18px] font-semibold tracking-[-0.01em]">
            Set up apps
          </h2>
          <p className="text-[13px] leading-[19px] text-muted mt-0.5">I only read while we set up. Anything I'd change waits for your yes.</p>
          {macMissing && <p className="text-[13px] leading-[19px] text-muted mt-2">Messages, Calendar and Reminders need Wisp on a Mac. You can add them later from one.</p>}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5">
          <ul className="rounded-[14px] border border-line divide-y divide-line">
            {shown.map((a) => (
              <AppRow key={a.id} app={a} mode={modes[a.id]} reason={options?.[a.catalogId ?? ""]?.reason} state={rows[a.id] ?? { phase: "idle" }} values={values[a.id] ?? {}} setValue={(k, v) => setValues((all) => ({ ...all, [a.id]: { ...all[a.id], [k]: v } }))} onAllow={() => void allow(a)} onKey={() => set(a.id, { phase: "key" })} onSave={() => void addKey(a)} onSignIn={() => void signIn(a)} />
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 safe-bottom">
          <button type="button" disabled={!doneIds.length} onClick={finish} className="ob-btn setup-press h-11 px-[22px] rounded-full bg-ink text-panel font-semibold disabled:opacity-40">
            {sheetCta(doneIds.length)}
          </button>
          <button type="button" onClick={finish} className="ob-btn h-11 px-4 rounded-full text-muted hover:text-ink">
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

function AppRow({ app, mode, reason, state, values, setValue, onAllow, onKey, onSave, onSignIn }: { app: StartApp; mode: RowMode; reason?: string; state: RowState; values: Record<string, string>; setValue: (k: string, v: string) => void; onAllow: () => void; onKey: () => void; onSave: () => void; onSignIn: () => void }) {
  const soon = mode === "soon";
  // can sign in, but this row has a key too (Slack, GitHub, Notion, Linear, Vercel)
  const keyToo = mode === "signin" && !!catalogConnector(app.catalogId!)?.fields.some((f) => !f.optional);
  const entry = app.catalogId ? catalogConnector(app.catalogId) : undefined;
  const fields = entry?.fields.filter((f) => !f.optional) ?? [];
  const link = entry?.fields.find((f) => f.link)?.link;
  let control: ReactNode;
  if (soon) control = <span className="text-[12px] font-medium text-faint" title={reason}>Soon</span>;
  else if (mode === "loading") control = <Loader2 size={14} className="animate-spin text-faint" aria-label="Checking" />;
  else if (state.phase === "done")
    control = (
      <span className="inline-flex items-center gap-1 text-[13px] text-muted">
        <Check size={15} strokeWidth={2.2} className="text-ink" aria-hidden />
        {app.how === "mac" ? "Allowed" : state.checked === false ? "Added" : "Connected"}
      </span>
    );
  else if (state.phase === "busy")
    control = (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        {app.how === "mac" ? "Asking macOS" : mode === "signin" ? "Signing in" : "Checking"}
      </span>
    );
  else if (state.phase === "key") control = null;
  else
    control = (
      <button type="button" onClick={app.how === "mac" ? onAllow : mode === "signin" ? onSignIn : onKey} className="ob-btn h-8 px-3.5 rounded-full border border-line2 bg-panel text-[13px] font-medium hover:bg-hover">
        {app.how === "mac" || mode === "signin" ? (state.phase === "failed" ? "Try again" : app.how === "mac" ? "Allow" : "Sign in") : "Add key"}
      </button>
    );
  return (
    <li className={`px-3.5 py-3 ${soon ? "opacity-55" : ""}`} aria-disabled={soon || undefined}>
      <div className="flex items-center gap-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted">
          <path d={app.icon} />
        </svg>
        <span className="flex-1 min-w-0">
          <strong className="block text-[14px] font-medium">{app.name}</strong>
          <span className="block text-[12px] leading-[17px] text-muted truncate">{app.what}</span>
        </span>
        {control}
      </div>
      {state.phase === "key" && (
        <form
          className="mt-2.5 flex flex-col gap-2 pl-8"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          {fields.map((f, i) => (
            <input
              key={f.key}
              autoFocus={i === 0}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              value={values[f.key] ?? ""}
              onChange={(e) => setValue(f.key, e.target.value)}
              placeholder={f.placeholder ?? f.label}
              aria-label={`${app.name} ${f.label}`}
              className="h-10 box-border px-3.5 rounded-[10px] border border-[var(--input)] bg-[var(--control)] text-ink text-[14px] outline-none focus:border-ink w-full min-w-0"
            />
          ))}
          {state.error && (
            <p role="alert" className="text-[13px] text-bad">
              {state.error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" className="ob-btn h-8 px-3.5 rounded-full bg-ink text-panel text-[13px] font-medium">
              Connect
            </button>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="text-[13px] text-muted hover:text-ink">
                Get a key ›
              </a>
            )}
          </div>
          <p className="text-[12px] text-faint">Paste it, or fill it from your password manager. Wisp keeps it and never shows it again.</p>
        </form>
      )}
      {state.phase === "failed" && state.error && (
        <p role="alert" className="mt-1.5 pl-8 text-[13px] text-bad">
          {state.error}
        </p>
      )}
      {keyToo && state.phase === "failed" && (
        <button type="button" onClick={onKey} className="mt-1 ml-8 text-[13px] text-muted hover:text-ink">
          Use a key instead
        </button>
      )}
    </li>
  );
}
