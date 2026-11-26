import { AppleOp, type AppleContact, type AppleEvent, type AppleMacStatus, type ApplePermission, type AppleReminder } from "@bubble-ai/core";
import { exec } from "../computers/driver.ts";
import { appIcons } from "./icons.ts";
import { ScriptError, runAppleScript } from "./jxa.ts";
import { CHAT_DB, DbError, SendError, allChats, fullDiskAccess, readChats, recentChats, searchMessages, sendService, sendText, unansweredChats } from "./messages.ts";
import { automationPermission, contactsPermission, eventKitPermission, handleKey, nameIndex, nameOf, permissionHolder, resolveChat, searchContacts, type ChatRow } from "./util.ts";

/**
 * The Apple mod's bridge on a Mac: Messages, Contacts, Calendar and Reminders for the hub's agents.
 * Reading never shows a macOS prompt; only `request_permission` does. Errors are said in plain
 * words, since they reach the person.
 */

const SETTINGS: Record<string, string> = {
  fullDiskAccess: "Privacy_AllFiles",
  automation: "Privacy_Automation",
  contacts: "Privacy_Contacts",
  calendars: "Privacy_Calendars",
  reminders: "Privacy_Reminders",
};

/** what a change answers: a confirmation to show, and the id of what it made */
export interface AppleDone {
  text: string;
  id?: string;
}

const CONTACTS_TTL = 10 * 60_000;
const CHATS_TTL = 60_000;
const STATUS_TTL = 5_000;

/** The person-facing error an op ends with. */
export class AppleError extends Error {}

export class AppleBridge {
  /** who macOS shows in System Settings for this node's permissions */
  readonly holder: string;
  /** the last thing sending or asking taught us about Automation (there's no silent check while Messages is closed) */
  private messagesControl: ApplePermission = "unknown";
  private contacts: { at: number; list: AppleContact[] } | null = null;
  private chats: { at: number; list: ChatRow[] } | null = null;
  private lastStatus: { at: number; value: AppleMacStatus } | null = null;

  constructor(private readonly db = CHAT_DB, holder?: string) {
    this.holder = holder ?? permissionHolder();
  }

  /** Every permission, as the Mac sees it. Never prompts. */
  async status(fresh = false): Promise<AppleMacStatus> {
    if (!fresh && this.lastStatus && Date.now() - this.lastStatus.at < STATUS_TTL) return this.lastStatus.value;
    const [fda, codes] = await Promise.all([
      fullDiskAccess(this.db),
      runAppleScript<{ contacts: number; calendars: number; reminders: number; automation: number }>({ op: "status" }, 15_000).catch(() => null),
    ]);
    const control = codes ? automationPermission(codes.automation) : null;
    if (control) this.messagesControl = control;
    const value: AppleMacStatus = {
      fullDiskAccess: fda,
      messagesControl: this.messagesControl,
      contacts: codes ? contactsPermission(codes.contacts) : "unknown",
      calendars: codes ? eventKitPermission(codes.calendars) : "unknown",
      reminders: codes ? eventKitPermission(codes.reminders) : "unknown",
      grantTo: this.holder,
    };
    if (value.contacts !== "allowed") this.contacts = null;
    this.lastStatus = { at: Date.now(), value };
    return value;
  }

  /**
   * Answer one op from the hub. `raw` is validated again here. `dry` (only for tests and checks
   * at the device, never from the hub) does a change up to the save and stops.
   */
  async handle(raw: unknown, opts: { dry?: boolean } = {}): Promise<unknown> {
    const parsed = AppleOp.safeParse(raw);
    if (!parsed.success) throw new AppleError(`That isn't something Bubble AI can do with Apple apps (${parsed.error.issues[0]?.message ?? "bad request"}).`);
    const op = parsed.data;
    const dry = !!opts.dry;
    try {
      switch (op.op) {
        case "status":
          return await this.status(true);
        case "request_permission":
          return await this.requestPermission(op.pane);
        case "icons":
          return await appIcons();
        case "messages_recent": {
          const chats = await this.chatRows();
          return await recentChats(op.limit, chats, await this.names(), this.db);
        }
        case "messages_read": {
          const chats = await this.chatRows();
          const r = resolveChat(op.chat, chats, await this.contactList());
          if (!r.ok) throw new AppleError(r.error);
          return await readChats(r.chats, op.limit, await this.names(), this.db);
        }
        case "messages_search":
          return await searchMessages(op.query, op.limit, await this.chatRows(), await this.names(), this.db);
        case "messages_unanswered": {
          if (op.minHours > op.maxHours) throw new AppleError("The shortest wait has to be less than the longest.");
          return await unansweredChats(op.minHours, op.maxHours, await this.chatRows(), await this.names(), Date.now(), this.db);
        }
        case "messages_send":
          return await this.send(op.to, op.text, dry);
        case "contacts_search":
          return searchContacts(await this.contactList(true), op.query, op.limit);
        case "calendar_list": {
          const from = Date.parse(op.from);
          let to = Date.parse(op.to);
          if (to <= from) throw new AppleError("The end of the range has to be after its start.");
          // EventKit looks at most four years at a time
          to = Math.min(to, from + 4 * 365 * 86_400_000);
          return await runAppleScript<AppleEvent[]>({ op: "calendar_list", from, to, limit: op.limit });
        }
        case "calendar_get":
          return await runAppleScript<AppleEvent | null>({ op: "calendar_get", id: op.id });
        case "calendar_create": {
          const start = Date.parse(op.start);
          const end = Date.parse(op.end);
          if (end < start) throw new AppleError("An event can't end before it starts.");
          const r = await runAppleScript<{ id?: string; calendar: string }>({ op: "calendar_create", calendar: op.calendar, title: op.title, start, end, allDay: op.allDay, location: op.location, notes: op.notes, dry });
          return done(`Added “${op.title}” to ${r.calendar} on ${when(op.start, op.allDay)}.`, r.id);
        }
        case "calendar_move": {
          const start = Date.parse(op.start);
          const end = Date.parse(op.end);
          if (end < start) throw new AppleError("An event can't end before it starts.");
          const r = await runAppleScript<{ id?: string; was: AppleEvent }>({ op: "calendar_move", id: op.id, start, end, dry });
          return done(`Moved “${r.was.title}” from ${when(r.was.start, r.was.allDay)} to ${when(op.start, r.was.allDay)}.`, r.id);
        }
        case "calendar_delete": {
          const r = await runAppleScript<{ was: AppleEvent }>({ op: "calendar_delete", id: op.id, dry });
          return done(`Deleted “${r.was.title}” (${when(r.was.start, r.was.allDay)}) from ${r.was.calendar}.`);
        }
        case "reminders_list":
          return await runAppleScript<AppleReminder[]>({ op: "reminders_list", list: op.list, includeDone: op.includeDone, limit: op.limit });
        case "reminders_get":
          return await runAppleScript<AppleReminder | null>({ op: "reminders_get", id: op.id });
        case "reminders_create": {
          const due = op.due ? Date.parse(op.due) : undefined;
          const r = await runAppleScript<{ id?: string; list: string }>({ op: "reminders_create", list: op.list, title: op.title, due, notes: op.notes, dry });
          return done(`Added “${op.title}” to ${r.list}${op.due ? `, due ${when(op.due)}` : ""}.`, r.id);
        }
        case "reminders_complete": {
          const r = await runAppleScript<{ was: AppleReminder }>({ op: "reminders_complete", id: op.id, dry });
          return done(`Marked “${r.was.title}” done.`);
        }
      }
    } catch (err) {
      throw this.plain(err, op.op);
    }
  }

  /** A permission's macOS prompt (when it hasn't asked yet) or its System Settings pane; answers the new status. */
  private async requestPermission(pane: string): Promise<AppleMacStatus> {
    const before = await this.status(true);
    // the exact list (Full Disk Access, Calendars…); macOS 13 and later only know the newer address
    const open = () =>
      exec("/usr/bin/open", [`x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${SETTINGS[pane]}`], { timeoutMs: 10_000 }).catch(() =>
        exec("/usr/bin/open", [`x-apple.systempreferences:com.apple.preference.security?${SETTINGS[pane]}`], { timeoutMs: 10_000 }),
      );
    if (pane === "fullDiskAccess") {
      // there's no prompt for it: the person adds the app in the list
      if (before.fullDiskAccess !== "allowed") await open();
    } else if (pane === "automation") {
      if (before.messagesControl === "allowed") return before;
      if (before.messagesControl !== "denied") {
        // the check needs Messages open; open it in the background, then let macOS ask
        await exec("/usr/bin/open", ["-g", "-j", "-b", "com.apple.MobileSMS"], { timeoutMs: 10_000 });
        await new Promise((r) => setTimeout(r, 1500));
        const r = await runAppleScript<{ code: number }>({ op: "request", what: "automation" }, 120_000).catch(() => null);
        const got = r ? automationPermission(r.code) : null;
        if (got) this.messagesControl = got;
      }
      if (this.messagesControl !== "allowed") await open();
    } else {
      const now = before[pane as "contacts" | "calendars" | "reminders"];
      if (now === "allowed") return before;
      if (now === "not_asked") await runAppleScript({ op: "request", what: pane }, 120_000).catch(() => null);
      const after = await this.status(true);
      if (after[pane as "contacts" | "calendars" | "reminders"] !== "allowed") await open();
      return after;
    }
    return this.status(true);
  }

  private async send(to: string, text: string, dry: boolean): Promise<AppleDone> {
    if (!handleKey(to)) throw new AppleError(`“${to}” isn't a phone number or email, so Bubble AI can't text it.`);
    const chats = await this.chatRows().catch(() => [] as ChatRow[]);
    const service = sendService(to, chats);
    try {
      await sendText(to, text, service, dry);
    } catch (err) {
      if (err instanceof SendError && err.kind === "not_allowed") this.messagesControl = "denied";
      throw err;
    }
    if (!dry) this.messagesControl = "allowed";
    const who = nameOf(to, await this.names());
    return done(`${dry ? "Ready to send" : "Sent"} to ${who} by ${service === "imessage" ? "iMessage" : service === "rcs" ? "RCS" : "text message"}.`);
  }

  /** Every conversation (cached a minute). */
  private async chatRows(): Promise<ChatRow[]> {
    if (this.chats && Date.now() - this.chats.at < CHATS_TTL) return this.chats.list;
    const list = await allChats(this.db);
    this.chats = { at: Date.now(), list };
    return list;
  }

  /**
   * Everyone in Contacts (cached ten minutes). For names in Messages this is best effort: without
   * the permission it's empty. `required`: say why it can't instead.
   */
  private async contactList(required = false): Promise<AppleContact[]> {
    if (this.contacts && Date.now() - this.contacts.at < CONTACTS_TTL) return this.contacts.list;
    try {
      const list = await runAppleScript<AppleContact[]>({ op: "contacts_all" }, 60_000);
      this.contacts = { at: Date.now(), list };
      return list;
    } catch (err) {
      if (required) throw err;
      return [];
    }
  }

  private async names(): Promise<Map<string, string>> {
    return nameIndex(await this.contactList());
  }

  /** Any failure, in words the person understands. */
  private plain(err: unknown, op: string): Error {
    if (err instanceof AppleError) return err;
    const where = `System Settings → Privacy & Security`;
    if (err instanceof DbError) {
      if (err.kind === "no_access") {
        this.lastStatus = null;
        return new AppleError(`Bubble AI can't read Messages yet: allow Full Disk Access for ${this.holder} in ${where} → Full Disk Access.`);
      }
      if (err.kind === "missing") return new AppleError("This Mac has no Messages history yet. Sign in to Messages on it first.");
      return new AppleError(`Bubble AI couldn't read Messages on this Mac (${err.message}).`);
    }
    if (err instanceof SendError) {
      if (err.kind === "not_allowed") return new AppleError(`Bubble AI isn't allowed to send texts yet: in ${where} → Automation, turn on Messages under ${this.holder}.`);
      if (err.kind === "no_account") return new AppleError("Messages on this Mac isn't signed in for that kind of text. Open Messages and sign in, or turn on Text Message Forwarding on your iPhone.");
      return new AppleError(`Messages couldn't send it (${err.message}).`);
    }
    if (err instanceof ScriptError) {
      const what = err.detail === "contacts" ? "Contacts" : err.detail === "calendars" ? "Calendars" : err.detail === "reminders" ? "Reminders" : op.startsWith("contacts") ? "Contacts" : op.startsWith("calendar") ? "Calendars" : "Reminders";
      switch (err.code) {
        case "NO_ACCESS":
          this.lastStatus = null;
          return new AppleError(`Bubble AI can't use ${what} yet: allow ${this.holder} in ${where} → ${what}.`);
        case "GONE":
          return new AppleError(op.startsWith("calendar") ? "That event isn't on this Mac's calendar anymore." : "That reminder isn't on this Mac anymore.");
        case "READ_ONLY":
          return new AppleError(`The “${err.detail}” calendar can't be changed from this Mac.`);
        case "NO_SUCH_CALENDAR":
          return new AppleError(`There's no calendar by that name on this Mac.${err.detail ? ` Its calendars: ${err.detail}.` : ""}`);
        case "NO_SUCH_LIST":
          return new AppleError(`There's no Reminders list by that name on this Mac.${err.detail ? ` Its lists: ${err.detail}.` : ""}`);
        case "NO_CALENDAR":
          return new AppleError("This Mac has no calendar to add events to. Pick one in Calendar's settings, or name a calendar.");
        case "NO_LIST":
          return new AppleError("This Mac has no Reminders list to add to. Make one in Reminders, or name a list.");
        case "TIMEOUT":
          return new AppleError(`${what} took too long to answer on this Mac. Try again in a moment.`);
        case "SAVE_FAILED":
          return new AppleError(`macOS wouldn't save the change (${err.detail}).`);
        default:
          return new AppleError(`${what} on this Mac didn't answer as expected (${err.message}).`);
      }
    }
    return new AppleError(`Something went wrong with the Apple apps on this Mac (${(err as Error)?.message ?? String(err)}).`);
  }
}

function done(text: string, id?: string): AppleDone {
  return id ? { text, id } : { text };
}

/** "Fri, Nov 20, 3:00 PM" in this Mac's time zone ("Fri, Nov 20" all day). */
export function when(iso: string, allDay = false): string {
  const d = new Date(iso);
  return allDay ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
