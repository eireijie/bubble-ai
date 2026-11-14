import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, ChevronRight, Laptop, Smartphone, X } from "lucide-react";
import { APPLE_APPS, APPLE_APP_INFO, type AppleApp, type AppleLevel, type AppleMacStatus, type ApplePlace, type AppleSettings, type AppleView, type APPLE_SETTINGS_PANES } from "@wisp/core";
import { api, observeEvents } from "../../api.ts";
import { href } from "../../router.ts";
import { useStore } from "../../store.ts";
import { AppleIcon, AppleSeg } from "../../components/AppleParts.tsx";
import { Switch } from "../../components/MarketParts.tsx";
import { AgentAvatar, Modal, cx } from "../../components/ui.tsx";
import { OwnersOnly, PageHeader } from "./parts.tsx";

type Pane = (typeof APPLE_SETTINGS_PANES)[number];
type Mac = AppleView["macs"][number];
type Phone = AppleView["iphones"][number];
/** PUT /api/apple/settings takes any top-level keys; levels and speakUp may be partial. */
export type ApplePatch = Partial<Omit<AppleSettings, "levels" | "speakUp">> & { levels?: Partial<AppleSettings["levels"]>; speakUp?: Partial<AppleSettings["speakUp"]> };

/** Each macOS permission the bridge needs, in the order the sheet lists them. */
export const MAC_PERMISSIONS: { key: Exclude<keyof AppleMacStatus, "messagesSignedIn">; pane: Pane; app: AppleApp; name: string; why: string }[] = [
  { key: "fullDiskAccess", pane: "fullDiskAccess", app: "messages", name: "Full Disk Access", why: "To read and search Messages" },
  { key: "messagesControl", pane: "automation", app: "messages", name: "Control Messages", why: "To send texts you approve" },
  { key: "contacts", pane: "contacts", app: "contacts", name: "Contacts", why: "To know who people are" },
  { key: "calendars", pane: "calendars", app: "calendar", name: "Calendars", why: "To see and plan events" },
  { key: "reminders", pane: "reminders", app: "reminders", name: "Reminders", why: "To see and add reminders" },
];

/** The permissions an app needs at a level: Messages reads with Full Disk Access and sends by controlling Messages. */
function needs(app: AppleApp, level: AppleLevel): (typeof MAC_PERMISSIONS)[number]["key"][] {
  if (level === 0) return [];
  if (app === "messages") return level === 2 ? ["fullDiskAccess", "messagesControl"] : ["fullDiskAccess"];
  if (app === "contacts") return ["contacts"];
  if (app === "calendar") return ["calendars"];
  if (app === "reminders") return ["reminders"];
  return [];
}

/** True when the Mac says an app is missing a permission it needs at this level (unknown isn't counted: the Mac couldn't tell). */
export function needsPermission(app: AppleApp, level: AppleLevel, status: AppleMacStatus | null | undefined): boolean {
  if (!status) return false;
  return needs(app, level).some((k) => status[k] === "denied" || status[k] === "not_asked");
}

/** The Mac that answers, as the hub picks it: the one chosen, else the first online (or only) Mac. */
export function activeMac(view: AppleView): Mac | null {
  const { macNodeId } = view.settings;
  if (macNodeId) return view.macs.find((m) => m.nodeId === macNodeId) ?? null;
  return view.macs.find((m) => m.online) ?? view.macs[0] ?? null;
}

/** The iPhone that answers for Location: the one picked, else the most recent. */
function activePhone(view: AppleView): Phone | null {
  return view.iphones.find((p) => p.id === view.settings.iphoneId) ?? (view.settings.iphoneId === null ? (view.iphones[0] ?? null) : null);
}

const DAY = 24 * 60 * 60 * 1000;
const phoneOnline = (p: Phone) => !!p.lastAt && Date.now() - new Date(p.lastAt).getTime() < DAY;

/** Merge a patch into settings, the way the hub does. */
function merged(s: AppleSettings, patch: ApplePatch): AppleSettings {
  return { ...s, ...patch, levels: { ...s.levels, ...patch.levels }, speakUp: { ...s.speakUp, ...patch.speakUp } };
}

/**
 * Settings → Apple (the Apple mod): which Mac and iPhone answer, what agents may do in each app,
 * which agents, and what they bring up on their own. Owners change it; members see it.
 */
export function ApplePage() {
  const isOwner = useStore((s) => s.me)?.role === "owner";
  const [view, setView] = useState<AppleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  /** the Mac whose permissions sheet is open */
  const [sheet, setSheet] = useState<string | null>(null);
  const [speak, setSpeak] = useState<SpeakKind | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<AppleView>("GET", "/api/apple").then(
        (v) => {
          if (!live) return;
          setView(v);
          setOff(false);
        },
        (e: { status?: number; message?: string }) => {
          if (!live) return;
          if (e.status === 404) setOff(true);
          else setError(e.message ?? "Couldn't load Apple settings.");
        },
      );
    void load();
    const stop = observeEvents((e) => e.type === "apple_changed" && void load());
    return () => {
      live = false;
      stop();
    };
  }, []);

  const save = async (patch: ApplePatch) => {
    if (!view) return;
    setError(null);
    const before = view;
    setView({ ...view, settings: merged(view.settings, patch) });
    try {
      setView(await api<AppleView>("PUT", "/api/apple/settings", patch));
    } catch (e) {
      setView(before);
      setError((e as Error).message);
    }
  };

  const pickMac = async (mac: Mac) => {
    await save({ macNodeId: mac.nodeId });
    // the first time a Mac answers, offer to fix whatever it isn't allowed to do yet
    if (mac.online && view && APPLE_APPS.some((a) => needsPermission(a, view.settings.levels[a], mac.status))) setSheet(mac.nodeId);
  };

  if (off)
    return (
      <>
        <PageHeader title="Apple" />
        <p className="text-sm text-muted">
          Apple is off.{" "}
          <a className="text-accent-text hover:underline" href={href({ view: "mods" })}>
            Turn it on in Mods
          </a>
          .
        </p>
      </>
    );

  const mac = view ? activeMac(view) : null;
  const phone = view ? activePhone(view) : null;
  const s = view?.settings;
  const sheetMac = sheet ? view?.macs.find((m) => m.nodeId === sheet) : undefined;

  return (
    <div className="max-w-[760px]">
      <PageHeader title="Apple">Messages, Contacts, Calendar, Reminders and Location, through your Mac and iPhone.</PageHeader>
      <OwnersOnly show={!isOwner} />
      {error && <p className="mb-4 text-sm text-bad">{error}</p>}
      {!view || !s ? (
        !error && <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-7">
          <Group title="Through">
            {view.macs.length === 0 && <DeviceRow icon={<Laptop size={18} strokeWidth={1.7} />} name="No Mac yet" sub={<a className="text-accent-text hover:underline" href={href({ view: "settings", page: "devices" })}>Add a Mac in Devices</a>} />}
            {view.macs.map((m) => {
              const used = m.nodeId === mac?.nodeId;
              return (
                <DeviceRow
                  key={m.nodeId}
                  icon={<Laptop size={18} strokeWidth={1.7} />}
                  name={m.name}
                  sub={used ? "Messages, Contacts, Calendar, Reminders" : "Not used"}
                  right={
                    used || !isOwner ? (
                      <Online on={m.online} />
                    ) : (
                      <span className="flex items-center gap-3">
                        <Online on={m.online} />
                        <button type="button" onClick={() => void pickMac(m)} className="h-7 rounded-full border border-control-line bg-control px-3 text-[13px] font-medium hover:bg-hover" aria-label={`Use ${m.name}`}>
                          Use
                        </button>
                      </span>
                    )
                  }
                />
              );
            })}
            {view.iphones.length === 0 ? (
              <DeviceRow icon={<Smartphone size={18} strokeWidth={1.7} />} name="No iPhone yet" sub="Turn on Apple in Wisp on your iPhone" />
            ) : (
              view.iphones.map((p) => {
                const used = p.id === phone?.id;
                return (
                  <DeviceRow
                    key={p.id}
                    icon={<Smartphone size={18} strokeWidth={1.7} />}
                    name={p.name}
                    sub={used ? "Location" : "Not used"}
                    right={
                      used || !isOwner ? (
                        <Online on={phoneOnline(p)} />
                      ) : (
                        <span className="flex items-center gap-3">
                          <Online on={phoneOnline(p)} />
                          <button type="button" onClick={() => void save({ iphoneId: p.id })} className="h-7 rounded-full border border-control-line bg-control px-3 text-[13px] font-medium hover:bg-hover" aria-label={`Use ${p.name}`}>
                            Use
                          </button>
                        </span>
                      )
                    }
                  />
                );
              })
            )}
          </Group>

          <section aria-labelledby="apple-apps" className="flex flex-col gap-2">
            <GroupTitle id="apple-apps">What agents can do</GroupTitle>
            <Box>
              {APPLE_APPS.map((app) => {
                const info = APPLE_APP_INFO[app];
                const level = s.levels[app];
                const where = info.where === "mac" ? mac : phone;
                const problem = info.where === "mac" && mac?.online && needsPermission(app, level, mac.status);
                return (
                  <div key={app} className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3.5 py-3">
                    <AppleIcon app={app} size={36} />
                    <div className="min-w-0 flex-1 basis-32">
                      <div className="text-[14px] font-medium">{info.name}</div>
                      {problem ? (
                        <div className="text-[13px] text-warn">
                          Needs permission ·{" "}
                          {isOwner ? (
                            <button type="button" onClick={() => setSheet(mac!.nodeId)} className="font-medium text-accent-text underline underline-offset-2">
                              Fix on the Mac
                            </button>
                          ) : (
                            "Fix on the Mac"
                          )}
                        </div>
                      ) : (
                        <div className="truncate text-[13px] text-muted">{where ? `On ${where.name}` : info.where === "mac" ? (view.macs.length ? "No Mac picked" : "No Mac yet") : "No iPhone yet"}</div>
                      )}
                    </div>
                    <AppleSeg
                      label={`${info.name} access`}
                      value={level}
                      disabled={!isOwner}
                      className="max-sm:w-full"
                      options={info.levels.map((l, i) => [i as AppleLevel, l] as const)}
                      onChange={(v) => void save({ levels: { [app]: v } })}
                    />
                  </div>
                );
              })}
            </Box>
            <p className="px-0.5 text-[13px] text-muted">Sending a text, or adding or changing an event or reminder, always asks you first.</p>
          </section>

          <section aria-labelledby="apple-agents" className="flex flex-col gap-2">
            <GroupTitle id="apple-agents">Agents</GroupTitle>
            <Box>
              {view.agents.length === 0 && <p className="px-3.5 py-3 text-[13px] text-muted">No agents yet.</p>}
              {view.agents.map((a) => (
                <AgentRow key={a.id} agent={a} on={s.allAgents || s.agentIds.includes(a.id)} disabled={!isOwner} onChange={(on) => void save(agentsPatch(s, view.agents, a.id, on))} />
              ))}
            </Box>
          </section>

          <section aria-labelledby="apple-speak" className="flex flex-col gap-2">
            <GroupTitle id="apple-speak">Speak up about</GroupTitle>
            <Box>
              {SPEAK.map((k) => (
                <button key={k.kind} type="button" onClick={() => setSpeak(k.kind)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-hover">
                  <span className="min-w-0 flex-1 text-[14px]">{k.label}</span>
                  <span className="max-w-[45%] truncate text-[13px] text-muted">{speakValue(k.kind, s)}</span>
                  <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
                </button>
              ))}
            </Box>
          </section>
        </div>
      )}
      {sheetMac && <MacSheet mac={sheetMac} onView={setView} onClose={() => setSheet(null)} />}
      {speak && s && <SpeakUpDialog kind={speak} settings={s} isOwner={isOwner} save={save} onClose={() => setSpeak(null)} />}
    </div>
  );
}

/** Ticking an agent on or off. Every agent ticked is "every agent", which includes ones added later. */
export function agentsPatch(s: AppleSettings, agents: AppleView["agents"], id: string, on: boolean): ApplePatch {
  const current = s.allAgents ? agents.map((a) => a.id) : s.agentIds.filter((x) => agents.some((a) => a.id === x));
  const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
  if (agents.length > 0 && agents.every((a) => next.includes(a.id))) return { allAgents: true, agentIds: [] };
  return { allAgents: false, agentIds: next };
}

// --- small pieces ---------------------------------------------------------------------------

function GroupTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="px-0.5 text-[13px] font-semibold text-muted">
      {children}
    </h3>
  );
}

function Box({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-panel">{children}</div>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = `apple-${title.toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <GroupTitle id={id}>{title}</GroupTitle>
      <Box>{children}</Box>
    </section>
  );
}

function DeviceRow({ icon, name, sub, right }: { icon: ReactNode; name: string; sub: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-chip text-ink/85">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{name}</div>
        {sub && <div className="truncate text-[13px] text-muted">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function Online({ on }: { on: boolean }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 text-[13px]", on ? "text-ok" : "text-faint")}>
      <span aria-hidden className={cx("size-[7px] rounded-full", on ? "bg-ok" : "bg-faint")} />
      {on ? "Connected" : "Offline"}
    </span>
  );
}

function AgentRow({ agent, on, disabled, onChange }: { agent: AppleView["agents"][number]; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const full = useStore((s) => s.agents.find((a) => a.id === agent.id));
  return (
    <label className={cx("flex items-center gap-3 px-3.5 py-2.5", !disabled && "cursor-pointer hover:bg-hover")}>
      <AgentAvatar agent={full ?? { name: agent.name, handle: agent.handle, harness: "claude" }} size={32} interactive={false} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{agent.name}</span>
        <span className="block truncate text-[13px] text-muted">{agent.role ?? `@${agent.handle}`}</span>
      </span>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-[18px] shrink-0 accent-[var(--accent-chats)]" />
    </label>
  );
}

// --- speak up ----------------------------------------------------------------------------------

type SpeakKind = "unanswered" | "calendar" | "reminders" | "places";
const SPEAK: { kind: SpeakKind; label: string }[] = [
  { kind: "unanswered", label: "Texts you haven't answered" },
  { kind: "calendar", label: "Clashes and early starts on your calendar" },
  { kind: "reminders", label: "Reminders coming due" },
  { kind: "places", label: "Arriving at or leaving a place" },
];

/** What a "Speak up about" row shows on its right. */
export function speakValue(kind: SpeakKind, s: AppleSettings): string {
  if (!s.speakUp[kind]) return "Off";
  if (kind === "unanswered") {
    const n = s.speakUp.unansweredFrom.length;
    return n === 0 ? "Anyone in Contacts" : n === 1 ? `From ${s.speakUp.unansweredFrom[0]}` : `From ${n} people`;
  }
  if (kind === "places") return s.places.length ? s.places.map((p) => p.name).join(", ") : "No places yet";
  return "On";
}

const placeWhen = (p: ApplePlace) => (p.arrive && p.leave ? "Arrive and leave" : p.arrive ? "Arrive only" : p.leave ? "Leave only" : "Off");

function SpeakUpDialog({ kind, settings: s, isOwner, save, onClose }: { kind: SpeakKind; settings: AppleSettings; isOwner: boolean; save: (p: ApplePatch) => Promise<void>; onClose: () => void }) {
  const label = SPEAK.find((k) => k.kind === kind)!.label;
  const [person, setPerson] = useState("");
  const from = s.speakUp.unansweredFrom;
  const add = () => {
    const v = person.trim();
    if (!v || from.includes(v)) return setPerson("");
    setPerson("");
    void save({ speakUp: { unansweredFrom: [...from, v] } });
  };
  return (
    <Sheet title={label} onClose={onClose} footer={<SmallButton primary onClick={onClose}>Done</SmallButton>}>
      <Box>
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <span className="flex-1 text-[14px]">Speak up</span>
          <Switch label={label} on={s.speakUp[kind]} disabled={!isOwner} onChange={(on) => void save({ speakUp: { [kind]: on } })} />
        </div>
      </Box>
      {kind === "unanswered" && s.speakUp.unanswered && (
        <div className="m-fade-in flex flex-col gap-2">
          <GroupTitle id="apple-from">Only from</GroupTitle>
          <Box>
            {from.length === 0 && <p className="px-3.5 py-2.5 text-[13px] text-muted">Anyone in Contacts</p>}
            {from.map((f) => (
              <div key={f} className="flex items-center gap-3 px-3.5 py-2">
                <span className="min-w-0 flex-1 truncate text-[14px]">{f}</span>
                {isOwner && (
                  <button type="button" aria-label={`Remove ${f}`} onClick={() => void save({ speakUp: { unansweredFrom: from.filter((x) => x !== f) } })} className="grid size-7 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            {isOwner && from.length < 100 && (
              <form
                className="flex items-center gap-2 px-3.5 py-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  add();
                }}
              >
                <input value={person} maxLength={200} onChange={(e) => setPerson(e.target.value)} placeholder="Name or number" aria-label="Name or number" className="h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
                <SmallButton type="submit" disabled={!person.trim()}>
                  Add
                </SmallButton>
              </form>
            )}
          </Box>
        </div>
      )}
      {kind === "places" && (
        <div className="flex flex-col gap-2">
          <GroupTitle id="apple-places">Places</GroupTitle>
          <Box>
            {s.places.length === 0 && <p className="px-3.5 py-2.5 text-[13px] text-muted">No places yet</p>}
            {s.places.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{p.name}</span>
                  <span className="block truncate text-[13px] text-muted">{placeWhen(p)}</span>
                </span>
                {isOwner && (
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => void save({ places: s.places.filter((x) => x.id !== p.id) })} className="grid size-7 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </Box>
          <p className="px-0.5 text-[13px] text-muted">Add places on your iPhone. Agents hear when you arrive or leave, never where you are in between.</p>
        </div>
      )}
    </Sheet>
  );
}

// --- the Mac's permissions ---------------------------------------------------------------------------

const POLL_MS = 3000;

/** "Let Wisp use Apple apps on this Mac": each permission, live, with a way to open System Settings for the ones not allowed. */
export function MacSheet({ mac, onView, onClose }: { mac: Mac; onView: (v: AppleView) => void; onClose: () => void }) {
  const [asking, setAsking] = useState<Pane | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => api<AppleView>("POST", "/api/apple/mac/refresh").then((v) => live && onView(v), () => {});
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [mac.nodeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ask = async (pane: Pane) => {
    setAsking(pane);
    setError(null);
    try {
      onView(await api<AppleView>("POST", "/api/apple/mac/permission", { pane }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(null);
    }
  };
  const status = mac.status;
  return (
    <Sheet
      title="Let Wisp use Apple apps on this Mac"
      sub="macOS asks once for each. Wisp checks again on its own."
      wide
      onClose={onClose}
      footer={
        <>
          <SmallButton onClick={onClose}>Later</SmallButton>
          <SmallButton primary onClick={onClose}>
            Done
          </SmallButton>
        </>
      }
    >
      {!mac.online && <p className="text-[13px] text-warn">{mac.name} is offline.</p>}
      <Box>
        {MAC_PERMISSIONS.map((p) => {
          const state = status?.[p.key] ?? "unknown";
          const ok = state === "allowed";
          // macOS shows its own prompt the first time (not for Full Disk Access); after that it's a switch in System Settings
          const asks = state === "not_asked" && p.pane !== "fullDiskAccess";
          return (
            <div key={p.key} className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 transition-colors duration-300", !ok && "bg-warn/[0.07]")}>
              <AppleIcon app={p.app} size={32} />
              <div className="min-w-0 flex-1 basis-36">
                <div className="text-[14px] font-medium">{p.name}</div>
                <div className={cx("text-[13px]", ok ? "text-muted" : "text-warn")}>{ok ? p.why : state === "unknown" ? "Not checked yet" : asks ? "Not allowed yet" : status?.grantTo ? `Turn on ${status.grantTo} in the list` : "Not allowed yet"}</div>
              </div>
              {ok ? (
                <span key="ok" className="m-swap inline-flex items-center gap-1.5 text-[13px] text-ok">
                  <Check size={16} strokeWidth={2.2} aria-hidden />
                  Allowed
                </span>
              ) : (
                <SmallButton disabled={!mac.online || asking !== null} onClick={() => void ask(p.pane)} className="max-sm:w-full">
                  {asks ? "Allow" : "Open Settings"}
                </SmallButton>
              )}
            </div>
          );
        })}
      </Box>
      <p className={cx("text-[13px]", status?.messagesSignedIn === false ? "text-warn" : "text-muted")}>Messages needs this Mac signed in to your Apple Account.</p>
      {error && <p className="text-[13px] text-bad">{error}</p>}
    </Sheet>
  );
}

/** The Apple pages' dialog: a sheet on phones, a 12px card on desktops, with a plain title. */
function Sheet({ title, sub, wide, onClose, footer, children }: { title: string; sub?: string; wide?: boolean; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  return (
    <Modal title={title} headerless onClose={onClose} className={cx("!rounded-t-[16px] sm:!rounded-xl", wide && "sm:!max-w-[600px]")} contentClassName="!p-0">
      <div className="flex flex-col gap-1 px-5 pb-3.5 pt-5 sm:px-6">
        <h2 className="text-[17px] font-semibold leading-snug">{title}</h2>
        {sub && <p className="text-[14px] text-muted">{sub}</p>}
      </div>
      <div className="flex flex-col gap-3 px-5 sm:px-6">{children}</div>
      <div className="flex justify-end gap-2 px-5 pb-5 pt-[18px] sm:px-6">{footer}</div>
    </Modal>
  );
}

function SmallButton({ primary, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      className={cx("h-[34px] whitespace-nowrap rounded-full px-4 text-[13px] font-medium disabled:opacity-50", primary ? "bg-accent px-[18px] text-accent-ink hover:bg-accent/90" : "border border-control-line bg-control hover:bg-hover", className)}
    />
  );
}
