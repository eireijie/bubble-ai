import { z } from "zod";

/**
 * The Apple mod: agents use Messages, Contacts, Calendar and Reminders through a Mac that joined
 * the hub, and Location through the iPhone app. Reading never asks; sending a text or adding,
 * moving or deleting an event or reminder always shows an approval card first.
 */

export const APPLE_APPS = ["messages", "contacts", "calendar", "reminders", "location"] as const;
export type AppleApp = (typeof APPLE_APPS)[number];

/** 0 off · 1 read (Location: when asked) · 2 read and change (Location: asked and places) */
export type AppleLevel = 0 | 1 | 2;

export const APPLE_APP_INFO: Record<AppleApp, { name: string; levels: [string, string, string]; where: "mac" | "iphone" }> = {
  messages: { name: "Messages", levels: ["Off", "Read", "Read and send"], where: "mac" },
  contacts: { name: "Contacts", levels: ["Off", "Read", "Read and change"], where: "mac" },
  calendar: { name: "Calendar", levels: ["Off", "Read", "Read and change"], where: "mac" },
  reminders: { name: "Reminders", levels: ["Off", "Read", "Read and change"], where: "mac" },
  location: { name: "Location", levels: ["Off", "When asked", "Asked and places"], where: "iphone" },
};

/** A place the iPhone watches: agents hear when you arrive or leave, never where you are in between. */
export const ApplePlace = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** metres */
  radius: z.number().min(50).max(5000),
  arrive: z.boolean(),
  leave: z.boolean(),
});
export type ApplePlace = z.infer<typeof ApplePlace>;

export const AppleSettings = z.object({
  /** the Mac that answers for Messages, Contacts, Calendar and Reminders (a node id); null: none picked */
  macNodeId: z.string().max(100).nullable(),
  levels: z.object({
    messages: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    contacts: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    calendar: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    reminders: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    location: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }),
  /** every agent may use it, or only `agentIds` */
  allAgents: z.boolean(),
  agentIds: z.array(z.string().max(100)).max(500),
  /** what agents bring up on their own (needs Background agents for the agent to wake) */
  speakUp: z.object({
    /** texts you haven't answered; `from`: only these handles or contact names (empty: anyone in Contacts) */
    unanswered: z.boolean(),
    unansweredFrom: z.array(z.string().trim().min(1).max(200)).max(100),
    calendar: z.boolean(),
    reminders: z.boolean(),
    places: z.boolean(),
  }),
  /** the iPhone (a push device id) that answers for Location; null: the most recent one that reported */
  iphoneId: z.string().max(200).nullable(),
  places: z.array(ApplePlace).max(20),
});
export type AppleSettings = z.infer<typeof AppleSettings>;

export const APPLE_DEFAULTS: AppleSettings = {
  macNodeId: null,
  // nothing until the person turns an app on and picks agents: macOS asks for each app as it's turned on
  levels: { messages: 0, contacts: 0, calendar: 0, reminders: 0, location: 0 },
  allAgents: false,
  agentIds: [],
  // off until the person turns it on: it puts the last words of other people's texts in front of agents
  speakUp: { unanswered: false, unansweredFrom: [], calendar: true, reminders: true, places: true },
  iphoneId: null,
  places: [],
};

/** Each macOS permission the bridge needs, as the Mac sees it. */
export const ApplePermission = z.enum(["allowed", "denied", "not_asked", "unknown"]);
export type ApplePermission = z.infer<typeof ApplePermission>;

/** What a Mac reports about the Apple bridge (part of its capabilities; absent on other platforms). */
export const AppleMacStatus = z.object({
  /** reading ~/Library/Messages/chat.db */
  fullDiskAccess: ApplePermission,
  /** sending through the Messages app (Automation) */
  messagesControl: ApplePermission,
  contacts: ApplePermission,
  calendars: ApplePermission,
  reminders: ApplePermission,
  /** Messages has an account signed in on this Mac */
  messagesSignedIn: z.boolean().optional(),
  /** the app macOS lists in System Settings for these permissions ("Bubble AI", "Terminal") */
  grantTo: z.string().max(300).optional(),
});
export type AppleMacStatus = z.infer<typeof AppleMacStatus>;

export const APPLE_SETTINGS_PANES = ["fullDiskAccess", "automation", "contacts", "calendars", "reminders"] as const;

const iso = z.string().datetime({ offset: true });
const limit = (max: number) => z.number().int().min(1).max(max);

/** What the hub asks a Mac to do. Change ops only ever run after a person approved them. */
export const AppleOp = z.discriminatedUnion("op", [
  /** check every permission (never prompts) */
  z.object({ op: z.literal("status") }),
  /** ask macOS for one permission (shows its prompt) or open its System Settings pane */
  z.object({ op: z.literal("request_permission"), pane: z.enum(APPLE_SETTINGS_PANES) }),
  /** the real app icons in color, read from the Mac's own apps (Bubble AI ships none): app → base64 PNG, 180×180, padding trimmed */
  z.object({ op: z.literal("icons") }),
  /** recent conversations, newest first */
  z.object({ op: z.literal("messages_recent"), limit: limit(50) }),
  /** one conversation's latest messages; `chat` is a chat id, phone number, email or contact name */
  z.object({ op: z.literal("messages_read"), chat: z.string().trim().min(1).max(200), limit: limit(200) }),
  z.object({ op: z.literal("messages_search"), query: z.string().trim().min(1).max(200), limit: limit(100) }),
  /** one-to-one conversations whose newest message is from them, at least `minHours` old and at most `maxHours` */
  z.object({ op: z.literal("messages_unanswered"), minHours: z.number().min(0).max(720), maxHours: z.number().min(1).max(720) }),
  /** `to`: a phone number or email (a handle) */
  z.object({ op: z.literal("messages_send"), to: z.string().trim().min(3).max(200), text: z.string().min(1).max(4000) }),
  z.object({ op: z.literal("contacts_search"), query: z.string().trim().min(1).max(200), limit: limit(50) }),
  z.object({ op: z.literal("calendar_list"), from: iso, to: iso, limit: limit(500) }),
  /** one event by id (null when it's gone) */
  z.object({ op: z.literal("calendar_get"), id: z.string().min(1).max(500) }),
  z.object({ op: z.literal("calendar_create"), calendar: z.string().max(200).optional(), title: z.string().trim().min(1).max(300), start: iso, end: iso, allDay: z.boolean().optional(), location: z.string().max(500).optional(), notes: z.string().max(4000).optional() }),
  z.object({ op: z.literal("calendar_move"), id: z.string().min(1).max(500), start: iso, end: iso }),
  z.object({ op: z.literal("calendar_delete"), id: z.string().min(1).max(500) }),
  z.object({ op: z.literal("reminders_list"), list: z.string().max(200).optional(), includeDone: z.boolean(), limit: limit(500) }),
  /** one reminder by id (null when it's gone) */
  z.object({ op: z.literal("reminders_get"), id: z.string().min(1).max(500) }),
  z.object({ op: z.literal("reminders_create"), list: z.string().max(200).optional(), title: z.string().trim().min(1).max(300), due: iso.optional(), notes: z.string().max(4000).optional() }),
  z.object({ op: z.literal("reminders_complete"), id: z.string().min(1).max(500) }),
]);
export type AppleOp = z.infer<typeof AppleOp>;
export type AppleOpName = AppleOp["op"];

/** Ops that change something: each goes through an approval card. */
export const APPLE_CHANGE_OPS = ["messages_send", "calendar_create", "calendar_move", "calendar_delete", "reminders_create", "reminders_complete"] as const satisfies readonly AppleOpName[];

/** Which app an op belongs to. */
export function appleAppOf(op: AppleOpName): Exclude<AppleApp, "location"> | null {
  if (op.startsWith("messages_")) return "messages";
  if (op.startsWith("contacts_")) return "contacts";
  if (op.startsWith("calendar_")) return "calendar";
  if (op.startsWith("reminders_")) return "reminders";
  return null;
}

// --- what the Mac answers (op → result) ------------------------------------------------------

export interface AppleChat {
  /** stable id to read it again */
  chatId: string;
  /** contact name or group name, else the handle */
  name: string;
  handles: string[];
  isGroup: boolean;
  lastText: string;
  lastAt: string;
  lastFromMe: boolean;
}

export interface AppleMessage {
  at: string;
  fromMe: boolean;
  /** contact name or handle of who wrote it ("me" when fromMe) */
  sender: string;
  text: string;
  /** set on search hits */
  chatId?: string;
  chatName?: string;
}

export interface AppleContact {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
  organization?: string;
  birthday?: string;
}

export interface AppleEvent {
  id: string;
  calendar: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
}

export interface AppleReminder {
  id: string;
  list: string;
  title: string;
  due?: string;
  done: boolean;
  notes?: string;
}

// --- approvals --------------------------------------------------------------------------------

/** An agent asking to send a text or change an event or reminder: what the card shows and what runs on yes. */
export interface AppleRequest {
  app: Exclude<AppleApp, "location">;
  op: AppleOp;
  /** the card's title: "Send a text", "Move an event" */
  title: string;
  /** small text by the title: "iMessage", "Work calendar" */
  aside: string;
  /** rows: To / Event / From / To; `was`: shown struck through */
  fields: { label: string; value: string; was?: boolean }[];
  /** the text being sent, shown as a blue bubble; the person may edit it before approving */
  bubble?: string;
  /** the main button's word: "Send", "Move it", "Add it" */
  yes: string;
  no: string;
  requestedBy: string | null;
}

// --- location ---------------------------------------------------------------------------------

export const AppleLocationReport = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** metres */
  accuracy: z.number().min(0).max(100_000),
  at: iso,
  /** answering a hub request (from a silent push) */
  requestId: z.string().max(100).optional(),
});
export type AppleLocationReport = z.infer<typeof AppleLocationReport>;

export const ApplePlaceEvent = z.object({ placeId: z.string().min(1).max(40), kind: z.enum(["arrive", "leave"]), at: iso });
export type ApplePlaceEvent = z.infer<typeof ApplePlaceEvent>;

/** What the iPhone / web see on Settings → Apple. */
export interface AppleView {
  settings: AppleSettings;
  /** Macs that joined this hub and can be the bridge; `status` when connected */
  macs: { nodeId: string; name: string; online: boolean; status: AppleMacStatus | null }[];
  /** iPhones that reported location: id and name, newest first */
  iphones: { id: string; name: string; lastAt: string | null }[];
  /** agents in this workspace, to pick from */
  agents: { id: string; name: string; handle: string; role: string | null }[];
}

/** A quiet line under an agent's reply saying what it read ("Read your last 5 texts with Sam"). */
export type AppleReadPart = { type: "apple_read"; app: AppleApp; text: string };
