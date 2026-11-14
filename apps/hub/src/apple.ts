import fs from "node:fs";
import path from "node:path";
import {
  APPLE_APP_INFO,
  APPLE_APPS,
  APPLE_DEFAULTS,
  AppleSettings,
  appleAppOf,
  type Agent,
  type AppleApp,
  type AppleChat,
  type AppleContact,
  type AppleEvent,
  type AppleLevel,
  type AppleLocationReport,
  type AppleMessage,
  type AppleOp,
  type AppleReadPart,
  type AppleReminder,
  type AppleRequest,
  type AppleView,
  type ApplePlaceEvent,
  type Approval,
  type MessagePart,
} from "@wisp/core";
import { id } from "./auth.ts";
import { featureOn } from "./features.ts";
import type { Hub } from "./hub.ts";
import type { FoundEvent } from "./watchers/index.ts";

/** A refusal or failure with words for the person or agent, and the HTTP status to send. */
export class AppleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const SETTINGS_KEY = "apple.settings";
const IPHONES_KEY = "apple.iphones";
/** How long reading or changing something on the Mac may take. */
const MAC_TIMEOUT_MS = 30_000;
/** A location fix this fresh is answered without waking the iPhone. */
const FRESH_LOCATION_MS = 5 * 60_000;
/** How long to wait for the iPhone to answer a silent push. */
const LOCATION_WAIT_MS = 25_000;
/** How often the Apple watch looks for things to bring up. */
export const APPLE_WATCH_MINUTES = 30;

type MacApp = Exclude<AppleApp, "location">;

interface IphoneSeen {
  id: string;
  name: string;
  userId: string;
  lastAt: string | null;
}

/**
 * The Apple mod on the hub: its settings, asking the bridge Mac to read or (after a person's OK)
 * change Messages, Contacts, Calendar and Reminders, the iPhone's location, and what agents bring
 * up on their own (an "apple" watch that reuses the watches' delivery and mention-once rules).
 */
export class Apple {
  private dataDir: string | null = null;
  /** what agents read during a run, shown under its reply */
  private runReads = new Map<string, AppleReadPart[]>();
  /** the latest fix per workspace (memory only: never a history) */
  private lastFix = new Map<string, AppleLocationReport & { deviceId: string }>();
  private waiting = new Map<string, { workspaceId: string; resolve: (r: AppleLocationReport) => void }>();
  private icons = new Map<string, Promise<Record<string, Buffer> | null>>();

  constructor(private hub: Hub) {}

  configure(opts: { dataDir: string }) {
    this.dataDir = opts.dataDir;
  }

  on(workspaceId: string) {
    return featureOn(this.hub.store, workspaceId, "apple");
  }

  // --- settings ----------------------------------------------------------------------------------

  settings(workspaceId: string): AppleSettings {
    const raw = this.hub.store.setting(workspaceId, SETTINGS_KEY);
    if (!raw) return structuredClone(APPLE_DEFAULTS);
    try {
      const s = JSON.parse(raw);
      return AppleSettings.parse({ ...APPLE_DEFAULTS, ...s, levels: { ...APPLE_DEFAULTS.levels, ...s.levels }, speakUp: { ...APPLE_DEFAULTS.speakUp, ...s.speakUp } });
    } catch {
      return structuredClone(APPLE_DEFAULTS);
    }
  }

  /** Change some settings (an owner). Partial `levels` / `speakUp` merge into what's saved. */
  save(workspaceId: string, patch: Partial<Omit<AppleSettings, "levels" | "speakUp">> & { levels?: Partial<AppleSettings["levels"]>; speakUp?: Partial<AppleSettings["speakUp"]> }): AppleSettings {
    const was = this.settings(workspaceId);
    const parsed = AppleSettings.safeParse({ ...was, ...patch, levels: { ...was.levels, ...patch.levels }, speakUp: { ...was.speakUp, ...patch.speakUp } });
    if (!parsed.success) throw new AppleError(parsed.error.issues[0]?.message ?? "Those settings aren't valid.");
    const next = parsed.data;
    if (next.macNodeId && !this.macs(workspaceId).some((m) => m.nodeId === next.macNodeId)) throw new AppleError("That Mac isn't part of this workspace.");
    const agents = new Set(this.hub.store.agents(workspaceId).map((a) => a.id));
    next.agentIds = [...new Set(next.agentIds)].filter((a) => agents.has(a));
    const ids = new Set<string>();
    for (const p of next.places) if (ids.has(p.id)) throw new AppleError("Two places have the same id.");
    else ids.add(p.id);
    this.hub.store.setSetting(workspaceId, SETTINGS_KEY, JSON.stringify(next));
    this.syncWatch(workspaceId);
    this.changed(workspaceId);
    return next;
  }

  changed(workspaceId: string) {
    this.hub.broadcast(workspaceId, { type: "apple_changed" });
  }

  /** Macs in the workspace (any device whose platform is darwin). */
  macs(workspaceId: string): AppleView["macs"] {
    return this.hub.store
      .nodes(workspaceId)
      .flatMap((n) => {
        const caps = this.hub.store.nodeCapabilities(n.id);
        if (caps?.platform !== "darwin") return [];
        return [{ nodeId: n.id, name: n.name, online: this.hub.isNodeOnline(n.id), status: caps.apple ?? null }];
      });
  }

  /** The Mac that answers: the one picked, else the only (or first online) Mac. */
  mac(workspaceId: string) {
    const macs = this.macs(workspaceId);
    const picked = this.settings(workspaceId).macNodeId;
    return macs.find((m) => m.nodeId === picked) ?? (picked ? undefined : (macs.find((m) => m.online) ?? macs[0]));
  }

  view(workspaceId: string): AppleView {
    return {
      settings: this.settings(workspaceId),
      macs: this.macs(workspaceId),
      iphones: this.iphones(workspaceId).map(({ id, name, lastAt }) => ({ id, name, lastAt })),
      agents: this.hub.store.agents(workspaceId).map((a) => ({ id: a.id, name: a.name, handle: a.handle, role: a.settings.role ?? null })),
    };
  }

  /** A Mac reported new capabilities: if it's the bridge, apps showing Settings → Apple refresh. */
  macReported(workspaceId: string, nodeId: string) {
    if (!this.on(workspaceId)) return;
    if (this.mac(workspaceId)?.nodeId === nodeId) this.changed(workspaceId);
  }

  // --- which agent may do what ------------------------------------------------------------------

  private agentAllowed(agent: Agent, s = this.settings(agent.workspaceId)) {
    return s.allAgents || s.agentIds.includes(agent.id);
  }

  /** Apps this agent may use and how far. */
  levelsFor(agent: Agent): Partial<Record<AppleApp, AppleLevel>> {
    if (!this.on(agent.workspaceId)) return {};
    const s = this.settings(agent.workspaceId);
    if (!this.agentAllowed(agent, s)) return {};
    return Object.fromEntries(APPLE_APPS.filter((a) => s.levels[a] > 0).map((a) => [a, s.levels[a]]));
  }

  private need(agent: Agent, app: AppleApp, level: 1 | 2) {
    if (!this.on(agent.workspaceId)) throw new AppleError("The Apple mod is off. Turn it on in Mods.", 404);
    const s = this.settings(agent.workspaceId);
    if (!this.agentAllowed(agent, s)) throw new AppleError(`${agent.name} isn't allowed to use Apple apps. The owner can change that in Settings → Apple.`, 403);
    const have = s.levels[app];
    if (have < level) {
      const what = APPLE_APP_INFO[app].name;
      throw new AppleError(have === 0 ? `${what} is off in Settings → Apple.` : `${what} is read-only in Settings → Apple${app === "messages" ? ", so texts can't be sent" : ""}.`, 403);
    }
  }

  // --- the Mac -----------------------------------------------------------------------------------

  /** Ask the bridge Mac; errors come back in words for the person. */
  async ask<T = unknown>(workspaceId: string, op: AppleOp, timeoutMs = MAC_TIMEOUT_MS): Promise<T> {
    const mac = this.mac(workspaceId);
    if (!mac) throw new AppleError("Apple apps need a Mac that joined Wisp. Add one in Computers, then pick it in Settings → Apple.", 409);
    if (!mac.online) throw new AppleError(`${mac.name} is offline, so Wisp can't reach its Apple apps right now.`, 503);
    try {
      return (await this.hub.computers.nodeRequest(mac.nodeId, (requestId) => ({ type: "apple", requestId, op }), timeoutMs)) as T;
    } catch (e) {
      throw new AppleError(e instanceof Error ? e.message : String(e), 502);
    }
  }

  /** Have the Mac show a permission prompt or open its System Settings pane, then refresh its status. */
  async requestPermission(workspaceId: string, pane: Extract<AppleOp, { op: "request_permission" }>["pane"]) {
    await this.ask(workspaceId, { op: "request_permission", pane }, 120_000);
  }

  async refresh(workspaceId: string) {
    await this.ask(workspaceId, { op: "status" }).catch(() => undefined);
  }

  /** The real app icon, read from the Mac's own apps once and kept (Wisp ships no Apple artwork). */
  async icon(workspaceId: string, app: AppleApp): Promise<Buffer | null> {
    const dir = this.dataDir ? path.join(this.dataDir, "apple-icons") : null;
    const file = dir && path.join(dir, `${app}.png`);
    if (file && fs.existsSync(file)) return fs.readFileSync(file);
    const mac = this.mac(workspaceId);
    if (!mac?.online) return null;
    let p = this.icons.get(mac.nodeId);
    if (!p) {
      p = this.ask<Record<string, string>>(workspaceId, { op: "icons" }).then(
        (r) => {
          const out: Record<string, Buffer> = {};
          for (const [k, v] of Object.entries(r ?? {})) if ((APPLE_APPS as readonly string[]).includes(k) && typeof v === "string") out[k] = Buffer.from(v, "base64");
          if (dir) {
            fs.mkdirSync(dir, { recursive: true });
            for (const [k, b] of Object.entries(out)) if (b.length && b.subarray(0, 4).toString("hex") === "89504e47") fs.writeFileSync(path.join(dir, `${k}.png`), b);
          }
          return out;
        },
        () => {
          this.icons.delete(mac.nodeId);
          return null;
        },
      );
      this.icons.set(mac.nodeId, p);
    }
    return (await p)?.[app] ?? null;
  }

  // --- what agents read --------------------------------------------------------------------------

  private noteRead(agent: Agent, runHeader: unknown, app: AppleApp, text: string) {
    const run = this.hub.runFor(agent.id, runHeader);
    if (!run) return;
    const list = this.runReads.get(run.id) ?? [];
    if (!list.some((p) => p.text === text) && list.length < 8) list.push({ type: "apple_read", app, text });
    this.runReads.set(run.id, list);
  }

  /** The `apple_read` lines for a run's reply; forgets them. */
  readParts(runId: string): MessagePart[] {
    const parts = this.runReads.get(runId) ?? [];
    this.runReads.delete(runId);
    return parts;
  }

  /** Who a handle belongs to, when Contacts may be read; else the handle itself. */
  private async nameFor(agent: Agent, handle: string): Promise<string | null> {
    if (this.settings(agent.workspaceId).levels.contacts < 1) return null;
    const hits = await this.ask<AppleContact[]>(agent.workspaceId, { op: "contacts_search", query: handle, limit: 3 }).catch(() => [] as AppleContact[]);
    const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
    const h = handle.includes("@") ? handle.toLowerCase() : digits(handle);
    return hits.find((c) => (handle.includes("@") ? c.emails.some((e) => e.toLowerCase() === h) : c.phones.some((p) => digits(p) === h)))?.name ?? null;
  }

  /** A read op from an agent: checked, run on the Mac, and noted under its reply. */
  async agentRead(agent: Agent, op: AppleOp, runHeader: unknown): Promise<unknown> {
    const app = appleAppOf(op.op);
    if (!app || isChange(op)) throw new AppleError("That isn't something to read.");
    this.need(agent, app, 1);
    const r = await this.ask(agent.workspaceId, op);
    this.noteRead(agent, runHeader, app, readLine(op, r));
    return r;
  }

  // --- changes (always asked first) ----------------------------------------------------------------

  async agentChange(agent: Agent, op: AppleOp, requestedBy: string | null): Promise<{ asked: string; summary: string }> {
    const app = appleAppOf(op.op);
    if (!app || !isChange(op)) throw new AppleError("That isn't a change.");
    this.need(agent, app, 2);
    const where = this.hub.whereIs(agent.id);
    if (!where) throw new AppleError("Nobody to ask: start from a conversation with the person.", 409);
    const req = await this.describe(agent, app, op, requestedBy);
    const summary = summaryOf(req);
    const approval = this.hub.store.createApproval({ workspaceId: agent.workspaceId, agentId: agent.id, ...where, summary, details: req.bubble ?? "", apple: req });
    this.hub.postMessage({ ...where, author: { kind: "agent", id: agent.id }, body: "", parts: [{ type: "approval", approvalId: approval.id }], route: false });
    this.hub.broadcast(agent.workspaceId, { type: "approval", approval }, this.hub.audience(approval.channelId));
    return { asked: approval.id, summary };
  }

  /** What the card shows, from the Mac's own data where there is some (never only the agent's word). */
  private async describe(agent: Agent, app: MacApp, op: AppleOp, requestedBy: string | null): Promise<AppleRequest> {
    const tz = this.timezoneOf(agent.workspaceId, requestedBy);
    const base = { app, op, requestedBy, no: "Leave it" };
    switch (op.op) {
      case "messages_send": {
        const name = await this.nameFor(agent, op.to);
        return { ...base, title: "Send a text", aside: "iMessage", fields: [{ label: "To", value: name ? `${name} · ${op.to}` : op.to }], bubble: op.text, yes: "Send", no: "Don't send" };
      }
      case "calendar_create":
        return { ...base, title: "Add an event", aside: op.calendar || "Calendar", fields: [{ label: "Event", value: op.title }, { label: "When", value: span(op.start, op.end, tz, op.allDay) }, ...(op.location ? [{ label: "Where", value: op.location }] : [])], yes: "Add it" };
      case "calendar_move":
      case "calendar_delete": {
        const ev = await this.ask<AppleEvent | null>(agent.workspaceId, { op: "calendar_get", id: op.id });
        if (!ev) throw new AppleError("That event isn't on the calendar any more.", 404);
        if (op.op === "calendar_delete") return { ...base, title: "Delete an event", aside: ev.calendar, fields: [{ label: "Event", value: ev.title }, { label: "When", value: span(ev.start, ev.end, tz, ev.allDay) }], yes: "Delete it" };
        return { ...base, title: "Move an event", aside: ev.calendar, fields: [{ label: "Event", value: ev.title }, { label: "From", value: span(ev.start, ev.end, tz, ev.allDay), was: true }, { label: "To", value: span(op.start, op.end, tz, ev.allDay) }], yes: "Move it" };
      }
      case "reminders_create":
        return { ...base, title: "Add a reminder", aside: op.list || "Reminders", fields: [{ label: "Reminder", value: op.title }, ...(op.due ? [{ label: "Due", value: when(op.due, tz) }] : [])], yes: "Add it" };
      case "reminders_complete": {
        const r = await this.ask<AppleReminder | null>(agent.workspaceId, { op: "reminders_get", id: op.id });
        if (!r) throw new AppleError("That reminder is gone.", 404);
        return { ...base, title: "Complete a reminder", aside: r.list, fields: [{ label: "Reminder", value: r.title }, ...(r.due ? [{ label: "Due", value: when(r.due, tz) }] : [])], yes: "Mark done" };
      }
      default:
        throw new AppleError("That isn't a change.");
    }
  }

  /** A person answered. On yes, do it now (with their edited text, for a text). Returns what the agent hears. */
  async decide(a: Approval, approve: boolean, edited?: string): Promise<string> {
    const req = a.apple!;
    if (!approve) return `Not allowed: don't ${req.title.toLowerCase()}.`;
    let op = req.op;
    if (edited !== undefined && op.op === "messages_send") op = { ...op, text: edited };
    // the settings may have changed since it was asked
    const agent = this.hub.store.agent(a.agentId);
    if (!agent) return "That agent is gone.";
    try {
      this.need(agent, req.app, 2);
      const done = await this.ask<unknown>(a.workspaceId, op);
      const said = typeof done === "string" ? done : typeof done === "object" && done && "message" in done ? String((done as { message: unknown }).message) : "Done.";
      return `Allowed. ${said}${edited !== undefined && edited !== req.bubble ? ` (They edited it first; what was sent: "${edited}")` : ""}`;
    } catch (e) {
      return `Allowed, but it didn't work: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private timezoneOf(workspaceId: string, userId: string | null): string | undefined {
    const members = this.hub.store.members(workspaceId);
    return (members.find((m) => m.id === userId) ?? members.find((m) => m.role === "owner"))?.timezone ?? undefined;
  }

  // --- location ------------------------------------------------------------------------------------

  private iphones(workspaceId: string): IphoneSeen[] {
    try {
      return JSON.parse(this.hub.store.setting(workspaceId, IPHONES_KEY) ?? "[]") as IphoneSeen[];
    } catch {
      return [];
    }
  }

  private seeIphone(workspaceId: string, userId: string, deviceId: string, name: string, at: string) {
    const list = this.iphones(workspaceId).filter((p) => p.id !== deviceId);
    list.unshift({ id: deviceId, name: name.slice(0, 80) || "iPhone", userId, lastAt: at });
    this.hub.store.setSetting(workspaceId, IPHONES_KEY, JSON.stringify(list.slice(0, 10)));
  }

  /** The iPhone sent where it is (on its own, or answering a request). */
  report(workspaceId: string, userId: string, r: AppleLocationReport & { deviceId: string; deviceName: string }) {
    if (!this.on(workspaceId)) throw new AppleError("The Apple mod is off. Turn it on in Mods.", 404);
    const s = this.settings(workspaceId);
    if (s.levels.location === 0) return;
    if (s.iphoneId && s.iphoneId !== r.deviceId) return;
    const known = this.iphones(workspaceId).some((p) => p.id === r.deviceId);
    this.seeIphone(workspaceId, userId, r.deviceId, r.deviceName, r.at);
    const { deviceName: _, ...fix } = r;
    this.lastFix.set(workspaceId, fix);
    if (r.requestId) {
      const w = this.waiting.get(r.requestId);
      if (w && w.workspaceId === workspaceId) {
        this.waiting.delete(r.requestId);
        w.resolve(fix);
      }
    }
    if (!known) this.changed(workspaceId);
  }

  /** Where the person is, for an agent: a fresh fix, else wake the iPhone with a silent push and wait. */
  async agentLocation(agent: Agent, runHeader: unknown): Promise<{ latitude: number; longitude: number; accuracyMeters: number; at: string; ageMinutes: number; near?: string }> {
    this.need(agent, "location", 1);
    const ws = agent.workspaceId;
    let fix = this.lastFix.get(ws);
    if (!fix || Date.now() - Date.parse(fix.at) > FRESH_LOCATION_MS) {
      const users = [...new Set(this.iphones(ws).map((p) => p.userId))];
      const owner = this.hub.store.members(ws).find((m) => m.role === "owner")?.id;
      const to = users.length ? users : owner ? [owner] : [];
      const requestId = id("loc");
      const answered = new Promise<AppleLocationReport>((resolve) => this.waiting.set(requestId, { workspaceId: ws, resolve }));
      let sent = 0;
      for (const u of to) sent += (await this.hub.apns.sendSilent(ws, u, { kind: "apple_location", requestId }).catch(() => ({ sent: 0 }))).sent;
      if (sent) {
        const got = await Promise.race([answered, new Promise<null>((r) => setTimeout(r, LOCATION_WAIT_MS))]);
        if (got) fix = this.lastFix.get(ws);
      }
      this.waiting.delete(requestId);
      if (!fix) throw new AppleError(sent ? "The iPhone didn't answer in time. It may be off or out of signal." : "No iPhone can answer: open Wisp on the iPhone once with Location allowed.", 503);
    }
    const s = this.settings(ws);
    const near = s.places.find((p) => metres(p.latitude, p.longitude, fix!.latitude, fix!.longitude) <= p.radius)?.name;
    this.noteRead(agent, runHeader, "location", near ? `Checked your location: at ${near}` : "Checked your location");
    return { latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: Math.round(fix.accuracy), at: fix.at, ageMinutes: Math.round((Date.now() - Date.parse(fix.at)) / 60_000), ...(near ? { near } : {}) };
  }

  /** The iPhone crossed a place's edge. */
  placeEvent(workspaceId: string, userId: string, e: ApplePlaceEvent & { deviceId: string }) {
    if (!this.on(workspaceId)) throw new AppleError("The Apple mod is off. Turn it on in Mods.", 404);
    const s = this.settings(workspaceId);
    const place = s.places.find((p) => p.id === e.placeId);
    if (!place || s.levels.location < 2 || !s.speakUp.places || !(e.kind === "arrive" ? place.arrive : place.leave)) return;
    const watchId = this.watchId(workspaceId);
    if (!watchId) return;
    this.hub.watches.recordFound(watchId, [{ kind: e.kind === "arrive" ? "place_arrive" : "place_leave", itemId: `place:${place.id}:${e.at}`, title: e.kind === "arrive" ? `You arrived at ${place.name}` : `You left ${place.name}`, happenedAt: e.at }]);
    void userId;
  }

  // --- speaking up -----------------------------------------------------------------------------------

  private watchId(workspaceId: string): string | null {
    return (this.hub.store.db.prepare("SELECT id FROM watches WHERE workspace_id = ? AND service = 'apple' LIMIT 1").get(workspaceId) as { id: string } | undefined)?.id ?? null;
  }

  /** Whose things these are: the Mac's owner, else the workspace's owner. */
  private personOf(workspaceId: string): string | null {
    const mac = this.mac(workspaceId);
    const node = mac && this.hub.store.nodes(workspaceId).find((n) => n.id === mac.nodeId);
    return node?.ownerId ?? this.hub.store.members(workspaceId).find((m) => m.role === "owner")?.id ?? null;
  }

  /** Keep one "apple" watch matching the settings: there while anything is set to speak up, with the allowed agents. */
  syncWatch(workspaceId: string) {
    const s = this.settings(workspaceId);
    const existing = this.watchId(workspaceId);
    const user = this.personOf(workspaceId);
    const wants = this.on(workspaceId) && !!user && ((s.speakUp.unanswered && s.levels.messages > 0) || (s.speakUp.calendar && s.levels.calendar > 0) || (s.speakUp.reminders && s.levels.reminders > 0) || (s.speakUp.places && s.levels.location === 2));
    const agentIds = this.hub.store
      .agents(workspaceId)
      .filter((a) => (s.allAgents || s.agentIds.includes(a.id)) && this.hub.answers(a, user))
      .map((a) => a.id);
    if (!wants || !agentIds.length) {
      if (existing) this.hub.watches.remove(existing);
      return;
    }
    if (existing) this.hub.watches.setApple(existing, user!, agentIds);
    else this.hub.watches.createApple(workspaceId, user!, agentIds, APPLE_WATCH_MINUTES);
  }

  /** The watch's look: unanswered texts, calendar clashes, reminders coming due. */
  async look(workspaceId: string, cursor: string | null, at: Date): Promise<{ cursor: string; events: FoundEvent[] }> {
    const s = this.settings(workspaceId);
    const events: FoundEvent[] = [];
    if (!this.on(workspaceId)) return { cursor: cursor ?? "{}", events };
    const tz = this.timezoneOf(workspaceId, this.personOf(workspaceId));
    if (s.speakUp.unanswered && s.levels.messages > 0) {
      const chats = await this.ask<AppleChat[]>(workspaceId, { op: "messages_unanswered", minHours: 2, maxHours: 48 });
      const from = s.speakUp.unansweredFrom.map((f) => f.toLowerCase());
      for (const c of chats ?? []) {
        if (from.length && !from.some((f) => c.name.toLowerCase().includes(f) || c.handles.some((h) => h.toLowerCase().includes(f)))) continue;
        events.push({ kind: "text_unanswered", itemId: `chat:${c.chatId}`, title: `${c.name} texted you and hasn't had an answer`, actor: c.name, preview: c.lastText.slice(0, 200), happenedAt: c.lastAt });
      }
    }
    if (s.speakUp.calendar && s.levels.calendar > 0) {
      const to = new Date(at.getTime() + 36 * 60 * 60_000);
      const evs = (await this.ask<AppleEvent[]>(workspaceId, { op: "calendar_list", from: at.toISOString(), to: to.toISOString(), limit: 200 })) ?? [];
      const timed = evs.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 0; i < timed.length; i++)
        for (let j = i + 1; j < timed.length && timed[j].start < timed[i].end; j++) {
          const [a, b] = [timed[i], timed[j]];
          events.push({ kind: "calendar_clash", itemId: `clash:${a.id}:${b.id}`, title: `${a.title} runs into ${b.title}`, preview: `${span(a.start, a.end, tz)} and ${span(b.start, b.end, tz)}`, happenedAt: b.start < at.toISOString() ? at.toISOString() : new Date(Math.min(Date.parse(a.start), at.getTime())).toISOString() });
        }
    }
    if (s.speakUp.reminders && s.levels.reminders > 0) {
      const soon = at.getTime() + 24 * 60 * 60_000;
      const rs = (await this.ask<AppleReminder[]>(workspaceId, { op: "reminders_list", includeDone: false, limit: 300 })) ?? [];
      for (const r of rs) if (r.due && Date.parse(r.due) <= soon) events.push({ kind: Date.parse(r.due) < at.getTime() ? "reminder_overdue" : "reminder_due", itemId: `reminder:${r.id}`, title: `Reminder due: ${r.title}`, preview: when(r.due, tz), happenedAt: r.due });
    }
    // each thing once: the same chat with a newer message, or a moved event, counts as new
    let seen: string[] = [];
    try {
      seen = (JSON.parse(cursor ?? "{}") as { seen?: string[] }).seen ?? [];
    } catch {
      seen = [];
    }
    const key = (e: FoundEvent) => `${e.itemId}@${e.happenedAt}`;
    const fresh = events.filter((e) => !seen.includes(key(e)));
    const next = [...new Set([...events.map(key), ...seen])].slice(0, 500);
    // the first look only learns what's already there
    return { cursor: JSON.stringify({ seen: next }), events: cursor === null ? [] : fresh };
  }

  /** For the agent's instructions: which Apple apps it has and how to use them. */
  promptSection(agent: Agent): string {
    const levels = this.levelsFor(agent);
    const apps = Object.entries(levels) as [AppleApp, AppleLevel][];
    if (!apps.length) return "";
    const line = ([app, lv]: [AppleApp, AppleLevel]) => `- ${APPLE_APP_INFO[app].name}: ${APPLE_APP_INFO[app].levels[lv].toLowerCase()}`;
    return [
      `## The person's Apple apps`,
      `Through their Mac and iPhone you can use (apple_* tools):`,
      ...apps.map(line),
      `Reading never asks. Sending a text, or adding, moving, deleting or completing an event or reminder, shows the person a card first; after one, end your turn and you'll get a message with their answer. Texts go out as the person, so draft them in their voice, short, and never send something they didn't ask for. Look people up in Contacts before texting a name.`,
    ].join("\n");
  }
}

// --- helpers ----------------------------------------------------------------------------------------

const CHANGES = new Set(["messages_send", "calendar_create", "calendar_move", "calendar_delete", "reminders_create", "reminders_complete"]);
export const isChange = (op: AppleOp) => CHANGES.has(op.op);

const summaryOf = (r: AppleRequest) => `${r.title}: ${r.fields.filter((f) => !f.was).map((f) => f.value).join(", ")}`.slice(0, 300);

/** The quiet line under the agent's reply. */
export function readLine(op: AppleOp, r: unknown): string {
  const n = Array.isArray(r) ? r.length : 0;
  const s = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  switch (op.op) {
    case "messages_recent":
      return `Looked at your ${s(n, "latest conversation", "latest conversations")} in Messages`;
    case "messages_read": {
      const who = (r as AppleMessage[] | undefined)?.find((m) => !m.fromMe)?.sender ?? op.chat;
      return `Read your last ${s(n, "text", "texts")} with ${who}`;
    }
    case "messages_search":
      return `Searched Messages for "${op.query.slice(0, 40)}"`;
    case "messages_unanswered":
      return "Checked for texts you haven't answered";
    case "contacts_search": {
      const first = (r as AppleContact[] | undefined)?.[0]?.name;
      return n === 1 && first ? `Found ${first} in Contacts` : `Searched Contacts for "${op.query.slice(0, 40)}"`;
    }
    case "calendar_list":
    case "calendar_get":
      return "Looked at your calendar";
    case "reminders_list":
    case "reminders_get":
      return "Looked at your reminders";
    default:
      return "Used your Apple apps";
  }
}

function fmt(iso: string, tz: string | undefined, o: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("en-US", { ...o, timeZone: tz }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", o).format(new Date(iso));
  }
}

/** "Thu 10:00–10:30 AM", "Thu 11:30 AM–Fri 1:00 PM", "Thu (all day)". */
export function span(start: string, end: string, tz?: string, allDay?: boolean): string {
  const day = (x: string) => fmt(x, tz, { weekday: "short", month: "short", day: "numeric" });
  if (allDay) return `${day(start)} (all day)`;
  const t = (x: string) => fmt(x, tz, { hour: "numeric", minute: "2-digit" });
  const sameDay = day(start) === day(end);
  const [a, b] = [t(start), t(end)];
  const am = (x: string) => x.slice(-2);
  if (sameDay) return `${day(start)}, ${am(a) === am(b) ? a.slice(0, -3) : a}–${b}`;
  return `${day(start)}, ${a} – ${day(end)}, ${b}`;
}

export const when = (iso: string, tz?: string) => fmt(iso, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Distance in metres between two points. */
export function metres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
