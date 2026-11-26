import { useEffect, useState, type ReactNode } from "react";
import { Laptop, LogOut, Smartphone, Volume2 } from "lucide-react";
import { api } from "../../api.ts";
import { useStore, usePrefs } from "../../store.ts";
import { THEMES, useAppearance, type ModeChoice } from "../../theme.ts";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../../push.ts";
import { androidPush, useAndroidPush } from "../../push-android.ts";
import { chime, enableNotifications, permission, setNotifyPrefs, show, useNotifyPrefs, type NotifyPrefs } from "../../notifications.ts";
import { Button, Field, IconButton, Input, cx, timeAgo } from "../../components/ui.tsx";
import { Card, Row, SavedNote, Toggle, useSavedFlash } from "./parts.tsx";
import { Group, SRow, Seg } from "./rows.tsx";
import { useFeature } from "../../features.ts";
import { GITHUB_URL } from "@bubble-ai/core";

const ANDROID_PUSH_DOC = `${GITHUB_URL}/blob/main/docs/deploy.md#push-notifications-for-the-android-app`;

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();
const HERE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// --- Profile ----------------------------------------------------------------------------------

/** Who you are, as four rows that save when you leave a field (or press Enter). */
export function ProfileRows() {
  const me = useStore((s) => s.me)!;
  const [f, setF] = useState({ name: me.user.name, email: me.user.email, preferredName: me.user.preferredName ?? "", timezone: me.user.timezone ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [saved, flash] = useSavedFlash();

  const save = async (next = f) => {
    const dirty = next.name !== me.user.name || next.email !== me.user.email || next.preferredName !== (me.user.preferredName ?? "") || next.timezone !== (me.user.timezone ?? "");
    if (!dirty) return;
    setError(null);
    try {
      const user = await api<typeof me.user>("PATCH", "/api/me", { name: next.name, email: next.email, preferredName: next.preferredName.trim() || null, timezone: next.timezone || null });
      useStore.setState((s) => (s.me ? { me: { ...s.me, user } } : {}));
      useStore.getState().load();
      flash();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  // a field that isn't valid yet (an empty name, half an email) waits; Enter says what's wrong
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (e.currentTarget.form?.checkValidity()) void save();
  };
  const inline = "h-9 flex-1 min-w-0 max-w-[260px] bg-transparent border-0 outline-none text-right text-body text-muted focus:text-ink placeholder:text-faint";
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <span className="absolute right-1 -top-5">
        <SavedNote shown={saved} />
      </span>
      <Group>
        <SRow id="name">
          <input className={inline} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={onBlur} required maxLength={80} aria-label="Name" />
        </SRow>
        <SRow id="preferred">
          <input className={inline} value={f.preferredName} onChange={(e) => setF({ ...f, preferredName: e.target.value })} onBlur={onBlur} placeholder={me.user.name.split(" ")[0]} maxLength={40} aria-label="What agents call you" />
        </SRow>
        <SRow id="email">
          <input className={inline} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} onBlur={onBlur} required aria-label="Email" />
        </SRow>
        <SRow id="timezone">
          <select
            value={f.timezone}
            onChange={(e) => {
              const next = { ...f, timezone: e.target.value };
              setF(next);
              if (e.currentTarget.form?.checkValidity()) void save(next);
            }}
            aria-label="Time zone"
            className="h-9 min-w-0 max-w-[260px] bg-transparent border-0 outline-none text-right text-body text-muted"
          >
            <option value="">Not set</option>
            <option value={HERE}>{HERE.replace(/_/g, " ")} (this device)</option>
            {ZONES.filter((z) => z !== HERE).map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </SRow>
      </Group>
      {error && (
        <p role="alert" className="mt-2 px-1 text-[13px] text-bad">
          {error}
        </p>
      )}
      <button type="submit" hidden />
    </form>
  );
}

// --- App behavior -----------------------------------------------------------------------------

export function EnterSwitch() {
  const prefs = usePrefs();
  const setPrefs = useStore((s) => s.setPrefs);
  return <Toggle label="Enter sends" on={prefs.sendWith === "enter"} onChange={(on) => void setPrefs({ sendWith: on ? "enter" : "mod-enter" })} />;
}

export function ClockSeg() {
  const prefs = usePrefs();
  const setPrefs = useStore((s) => s.setPrefs);
  return (
    <Seg
      label="Clock"
      value={prefs.clock}
      onChange={(v) => void setPrefs({ clock: v })}
      options={[
        ["auto", "Automatic"],
        ["12h", "12-hour"],
        ["24h", "24-hour"],
      ]}
    />
  );
}

export function ToolCallsSeg() {
  const prefs = usePrefs();
  const setPrefs = useStore((s) => s.setPrefs);
  return (
    <Seg
      label="Tool calls"
      value={prefs.toolCalls}
      onChange={(v) => void setPrefs({ toolCalls: v })}
      options={[
        ["collapsed", "Collapsed"],
        ["expanded", "Open"],
        ["hidden", "Hidden"],
      ]}
    />
  );
}

// --- Notifications ----------------------------------------------------------------------------

export type NotifyKey = "on" | "off" | "blocked" | "ask" | "unsupported";

/** What notifications are doing on THIS device, in plain words. */
export function notifyStatus(perm: NotificationPermission | "unsupported", enabled: boolean): { key: NotifyKey; label: string; hint: string } {
  if (perm === "unsupported") return { key: "unsupported", label: "Not available in this browser", hint: "This browser can't show notifications. On an iPhone, add Bubble AI to your Home Screen first (Share, then Add to Home Screen)." };
  if (perm === "denied") return { key: "blocked", label: "Blocked by your browser", hint: "Your browser is blocking them for this site. Allow notifications in the site's settings (the icon left of the address), then reload." };
  if (perm === "default") return { key: "ask", label: "Not asked yet", hint: "Your browser will ask for permission when you turn them on." };
  return enabled ? { key: "on", label: "On", hint: "You'll get notifications on this device." } : { key: "off", label: "Off", hint: "Switched off on this device. Switch it on to get them." };
}

/** Push state for this device, shared by the main switch and the push row. */
function usePush() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void currentSubscription().then((s) => setOn(!!s), () => setOn(false));
  }, []);
  const change = async (want: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      if (want) {
        const r = await enablePush();
        if (r.ok) setOn(true);
        else setNote(r.reason);
      } else {
        await disablePush();
        setOn(false);
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    const r = await api<{ sent: number }>("POST", "/api/push/test").catch(() => ({ sent: 0 }));
    setNote(r.sent ? null : "Nothing was sent. Turn push off and on again.");
  };
  return { on, busy, note, change, test };
}

/** What the Notifications row says: the state on this device, in a word or two. */
export function NotifyValue() {
  return androidPush() ? <AndroidNotifyValue /> : <BrowserNotifyValue />;
}
function AndroidNotifyValue() {
  const android = useAndroidPush();
  return <>{android.allowed && android.registered ? "On" : "Off"}</>;
}
function BrowserNotifyValue() {
  const prefs = useNotifyPrefs();
  const key = notifyStatus(permission(), prefs.enabled).key;
  return <>{key === "on" ? "On" : key === "blocked" ? "Blocked" : key === "unsupported" ? "Not available" : "Off"}</>;
}

export function NotificationsPage() {
  // Bubble AI's Android app: a web view can't do Web Push, so the app's own push is shown instead
  if (androidPush()) return <AndroidNotificationsPage />;
  return <BrowserNotificationsPage />;
}

/** Notifications in the Android app: its native push, and a test. */
function AndroidNotificationsPage() {
  const push = useAndroidPush();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // only the state that needs the owner to act keeps its sentence
  const status: { label: string; hint: ReactNode } =
    push.hubReady === null
      ? { label: "Checking…", hint: null }
      : !push.hubReady
        ? {
            label: "Not set up",
            hint: (
              <>
                Push isn't set up on this Bubble AI yet.{" "}
                <a href={ANDROID_PUSH_DOC} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">
                  How to set it up
                </a>
              </>
            ),
          }
        : !push.allowed
          ? { label: "Off", hint: null }
          : push.registered
            ? { label: "On", hint: null }
            : { label: "Connecting…", hint: null };
  const sendTest = async () => {
    setBusy(true);
    setNote(null);
    const ok = await push.test();
    setNote(ok ? "Sent." : "Nothing was sent. Check that notifications are on for Bubble AI in your phone's settings.");
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <Card>
        <Row label="Notifications">
          <span className="text-muted">{status.label}</span>
          {push.hubReady && !push.allowed && (
            <Button variant="primary" onClick={push.turnOn}>
              Turn on
            </Button>
          )}
        </Row>
        {push.hubReady && push.allowed && push.registered && (
          <Row label="Test">
            <Button disabled={busy} onClick={() => void sendTest()}>
              Send a test
            </Button>
          </Row>
        )}
      </Card>
      {status.hint && <p className="px-1 text-[13px] text-muted">{status.hint}</p>}
      {note && (
        <p role="status" className="px-1 text-[13px] text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

function BrowserNotificationsPage() {
  const prefs = useNotifyPrefs();
  const tasksOn = useFeature("tasks");
  const push = usePush();
  const [perm, setPerm] = useState(permission());
  const [starting, setStarting] = useState(false);
  const status = notifyStatus(perm, prefs.enabled);
  const on = status.key === "on";
  const turnOn = async () => {
    setStarting(true);
    try {
      const p = await enableNotifications();
      setPerm(p);
      // so they also arrive while Bubble AI is closed; if that can't be done, say why but keep going
      if (p === "granted" && pushSupported()) await push.change(true);
    } finally {
      setStarting(false);
    }
  };
  const toggle = (k: keyof NotifyPrefs) => (v: boolean) => setNotifyPrefs({ [k]: v });
  // one test: here, and a push too while push is on
  const sendTest = () => {
    show("Bubble AI", "Notifications work on this device.", undefined, { test: true });
    if (push.on) void push.test();
  };
  const events: [keyof NotifyPrefs, string][] = [
    ["dms", "Direct messages"],
    ["replies", "Replies to you"],
    ["approvals", "Approvals"],
    ["help", "Help on a computer"],
    ["tasks", "Finished tasks"],
  ];
  const shownEvents = tasksOn ? events : events.filter(([k]) => k !== "tasks");
  const canPush = !window.wispDesktop && pushSupported() && push.on !== null;
  return (
    <div className="space-y-4">
      <Card>
        <Row label="Notifications">
          {perm !== "granted" && <span className="text-muted">{status.key === "ask" ? "Off" : status.label}</span>}
          {status.key === "ask" && (
            <Button variant="primary" disabled={starting} onClick={() => void turnOn()}>
              {starting ? "Turning on…" : "Turn on"}
            </Button>
          )}
          {perm === "granted" && <Toggle label="Notifications on this device" on={prefs.enabled} onChange={toggle("enabled")} />}
        </Row>
        {canPush && (
          <Row label="When Bubble AI is closed">
            <Toggle label="Push to this device" on={!!push.on} disabled={push.busy} onChange={(v) => void push.change(v)} />
          </Row>
        )}
      </Card>
      {/* only said when the switch can't work */}
      {(status.key === "blocked" || status.key === "unsupported") && <p className="px-1 text-[13px] text-muted">{status.hint}</p>}
      {push.note && (
        <p role="status" className="px-1 text-[13px] text-muted">
          {push.note}
        </p>
      )}
      {on && (
        <Card>
          <Row label="Only when I'm away">
            <Toggle label="Only when I'm away" on={prefs.onlyAway} onChange={toggle("onlyAway")} />
          </Row>
          <Row label="Sound">
            <IconButton icon={<Volume2 size={15} />} label="Play the sound" onClick={chime} />
            <Toggle label="Play a sound" on={prefs.sound} onChange={toggle("sound")} />
          </Row>
          <Row label="Test">
            <Button onClick={sendTest}>Send a test</Button>
          </Row>
        </Card>
      )}
      <Card>
        {shownEvents.map(([k, label]) => (
          <Row key={k} label={label}>
            <Toggle label={label} on={!!prefs[k]} onChange={toggle(k)} />
          </Row>
        ))}
      </Card>
    </div>
  );
}

// --- Appearance -------------------------------------------------------------------------------

export function ModeSeg() {
  const { mode, setMode } = useAppearance();
  const modes: [ModeChoice, ReactNode][] = [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  return <Seg label="Appearance" value={mode} options={modes} onChange={setMode} />;
}

/** The themes as dots: each carries its own theme, so it shows that theme's colour. */
export function ThemeSwatches() {
  const { resolvedMode, theme, setTheme } = useAppearance();
  return (
    <div className="flex shrink-0 items-center gap-1.5" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          aria-label={t.name}
          title={t.name}
          onClick={() => setTheme(t.id)}
          data-theme={t.id}
          data-mode={resolvedMode}
          className={cx("size-7 rounded-full grid place-items-center border", theme === t.id ? "border-ink" : "border-transparent hover:border-line")}
        >
          <span className="size-[18px] rounded-full bg-accent" />
        </button>
      ))}
    </div>
  );
}

export function TextSizeSeg() {
  const { textSize, setTextSize } = useAppearance();
  return (
    <Seg
      label="Text size"
      value={textSize}
      onChange={setTextSize}
      options={[
        ["small", "Small"],
        ["default", "Default"],
        ["large", "Large"],
      ]}
    />
  );
}

export function MotionSwitch() {
  const { reduceMotion, setReduceMotion } = useAppearance();
  return <Toggle label="Reduce motion" on={reduceMotion} onChange={setReduceMotion} />;
}

// --- Security ---------------------------------------------------------------------------------

interface Session {
  id: string;
  label: string;
  createdAt: string;
  lastUsed: string | null;
  current: boolean;
}

/** What the Signed in row says: how many places. */
export function SessionsValue() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    api<Session[]>("GET", "/api/me/sessions").then((s) => setN(s.length), () => {});
  }, []);
  return <>{n === null ? "" : `${n} device${n === 1 ? "" : "s"}`}</>;
}

/** Where you're signed in, with Sign out for each and for everywhere else. */
export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Session[]>("GET", "/api/me/sessions").then(setSessions, (e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, []);
  const signOut = async (s: Session) => {
    await api("DELETE", `/api/me/sessions/${s.id}`).catch((e) => setError((e as Error).message));
    load();
  };
  const others = (sessions ?? []).filter((s) => !s.current);
  const icon = (label: string) => (/iPhone|Android|iPad/.test(label) ? <Smartphone size={16} /> : <Laptop size={16} />);
  return (
    <div className="space-y-4">
      {error && <p className="px-1 text-sm text-bad">{error}</p>}
      <Card>
        {(sessions ?? []).map((s) => (
          <div key={s.id} className="px-4 min-h-[52px] flex items-center gap-3">
            <span className="shrink-0 text-muted">{icon(s.label)}</span>
            <div className="min-w-0 flex-1 truncate text-body">
              {s.label === "login" || s.label === "setup" ? "A browser" : s.label}
              <span className="text-muted"> · {s.current ? "This device" : timeAgo(s.lastUsed ?? s.createdAt)}</span>
            </div>
            {!s.current && (
              <Button variant="ghost" onClick={() => signOut(s)}>
                Sign out
              </Button>
            )}
          </div>
        ))}
        {sessions === null && <p className="px-4 py-3 text-sm text-muted">Loading…</p>}
      </Card>
      {others.length > 0 && (
        <Button
          onClick={async () => {
            await api("POST", "/api/me/sessions/sign-out-others").catch((e) => setError((e as Error).message));
            load();
          }}
        >
          <LogOut size={14} /> Sign out everywhere else
        </Button>
      )}
    </div>
  );
}

export function PasswordForm() {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, flash] = useSavedFlash();
  return (
    <form
      className="space-y-4 max-w-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (f.next !== f.again) return setError("The new passwords don't match.");
        setBusy(true);
        try {
          await api("POST", "/api/me/password", { current: f.current, next: f.next });
          setF({ current: "", next: "", again: "" });
          flash();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Current password">
        <Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <Input type="password" autoComplete="new-password" minLength={8} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required />
      </Field>
      <Field label="New password again">
        <Input type="password" autoComplete="new-password" minLength={8} value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} required />
      </Field>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={busy}>
          {busy ? "Changing…" : "Change password"}
        </Button>
        <SavedNote shown={saved} />
      </div>
    </form>
  );
}
