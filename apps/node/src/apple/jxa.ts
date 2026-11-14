import { exec } from "../computers/driver.ts";

/**
 * Contacts, Calendar, Reminders and the permission checks, through the real frameworks
 * (CNContactStore, EKEventStore) from JavaScript for Automation. One script; the request goes in as
 * JSON on argv (never into the script text) and the answer comes back as JSON.
 *
 * Every data op checks the framework's authorization status first and stops with NO_ACCESS when
 * it isn't allowed, so nothing here shows a macOS prompt except `request`. `dry: true` on a change
 * does everything but the save.
 */
export const APPLE_SCRIPT = String.raw`
ObjC.import("Foundation");
ObjC.import("Contacts");
ObjC.import("EventKit");
ObjC.import("CoreServices");
ObjC.bindFunction("AEDeterminePermissionToAutomateTarget", ["int", ["void *", "unsigned int", "unsigned int", "bool"]]);

const MESSAGES = "com.apple.MobileSMS";
const WILD = 0x2a2a2a2a;

function s(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (v.isNil && v.isNil()) return "";
  const u = ObjC.unwrap(v);
  return u === undefined || u === null ? "" : String(u);
}
function nsDate(ms) { return $.NSDate.dateWithTimeIntervalSince1970(ms / 1000); }
function isoOf(d) { return d && !d.isNil() ? new Date(d.timeIntervalSince1970 * 1000).toISOString() : undefined; }
function arr(a) { const out = []; if (!a || a.isNil()) return out; const n = a.count; for (let i = 0; i < n; i++) out.push(a.objectAtIndex(i)); return out; }
function wait(done, seconds) {
  const end = Date.now() + seconds * 1000;
  while (!done() && Date.now() < end) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
}
function fail(code, detail) { throw new Error(code + (detail ? ": " + detail : "")); }
function errText(ref) { const e = ref[0]; return e && !e.isNil() ? s(e.localizedDescription) : "unknown error"; }

function cnStatus() { return Number($.CNContactStore.authorizationStatusForEntityType(0)); }
function ekStatus(type) { return Number($.EKEventStore.authorizationStatusForEntityType(type)); }
function automation(ask) {
  const d = $.NSAppleEventDescriptor.descriptorWithBundleIdentifier(MESSAGES);
  return Number($.AEDeterminePermissionToAutomateTarget(d.aeDesc, WILD, WILD, !!ask));
}
function needContacts() { const c = cnStatus(); if (c !== 3 && c !== 4) fail("NO_ACCESS", "contacts"); }
function needEvents() { if (ekStatus(0) !== 3) fail("NO_ACCESS", "calendars"); }
function needReminders() { if (ekStatus(1) !== 3) fail("NO_ACCESS", "reminders"); }

// --- contacts --------------------------------------------------------------------------------
function contactsAll() {
  needContacts();
  const store = $.CNContactStore.alloc.init;
  const keys = $(["identifier", "givenName", "familyName", "nickname", "organizationName", "phoneNumbers", "emailAddresses", "birthday"]);
  // one pass over every unified contact (asking for containers first can come back empty)
  const req = $.CNContactFetchRequest.alloc.initWithKeysToFetch(keys);
  req.unifyResults = true;
  const found = [];
  store.enumerateContactsWithFetchRequestErrorUsingBlock(req, Ref(), (c) => { found.push(c); });
  const seen = {};
  const out = [];
  for (const c of found) {
    const id = s(c.identifier);
    if (seen[id]) continue;
    seen[id] = true;
    const org = s(c.organizationName);
    const name = [s(c.givenName), s(c.familyName)].filter(Boolean).join(" ") || s(c.nickname) || org;
    const phones = arr(c.phoneNumbers).map((p) => s(p.value.stringValue)).filter(Boolean);
    const emails = arr(c.emailAddresses).map((e) => s(e.value)).filter(Boolean);
    const item = { id: id, name: name, phones: phones, emails: emails };
    if (org && org !== name) item.organization = org;
    const b = c.birthday;
    if (b && !b.isNil()) {
      const m = Number(b.month), d = Number(b.day), y = Number(b.year);
      const pad = (n) => (n < 10 ? "0" : "") + n;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) item.birthday = (y > 0 && y < 10000 ? y : "-") + "-" + pad(m) + "-" + pad(d);
    }
    out.push(item);
  }
  return out;
}

// --- calendar --------------------------------------------------------------------------------
function eventStore() { return $.EKEventStore.alloc.init; }
/** a recurring event's occurrences share one identifier, so their ids carry the start too */
function eventId(e) {
  const id = s(e.eventIdentifier);
  return e.hasRecurrenceRules ? id + "::" + Math.round(e.startDate.timeIntervalSince1970 * 1000) : id;
}
function eventOut(e) {
  const out = { id: eventId(e), calendar: s(e.calendar.title), title: s(e.title), start: isoOf(e.startDate), end: isoOf(e.endDate), allDay: !!e.allDay };
  const loc = s(e.location), notes = s(e.notes);
  if (loc) out.location = loc;
  if (notes) out.notes = notes.slice(0, 4000);
  return out;
}
function findEvent(store, id) {
  const cut = id.lastIndexOf("::");
  if (cut < 0) { const e = store.eventWithIdentifier(id); return e && !e.isNil() ? e : null; }
  const eid = id.slice(0, cut), at = Number(id.slice(cut + 2));
  const pred = store.predicateForEventsWithStartDateEndDateCalendars(nsDate(at - 1000), nsDate(at + 1000), null);
  for (const e of arr(store.eventsMatchingPredicate(pred))) {
    if (s(e.eventIdentifier) === eid && Math.abs(e.startDate.timeIntervalSince1970 * 1000 - at) < 1000) return e;
  }
  return null;
}
function calendarList(r) {
  needEvents();
  const store = eventStore();
  const pred = store.predicateForEventsWithStartDateEndDateCalendars(nsDate(r.from), nsDate(r.to), null);
  const evs = arr(store.eventsMatchingPredicate(pred)).map(eventOut);
  evs.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return evs.slice(0, r.limit);
}
function calendarGet(r) { needEvents(); const e = findEvent(eventStore(), r.id); return e ? eventOut(e) : null; }
function writableCalendar(store, name) {
  if (!name) { const c = store.defaultCalendarForNewEvents; if (!c || c.isNil()) fail("NO_CALENDAR"); return c; }
  const cals = arr(store.calendarsForEntityType(0)).filter((c) => c.allowsContentModifications);
  const lower = name.toLowerCase();
  const c = cals.find((c) => s(c.title) === name) || cals.find((c) => s(c.title).toLowerCase() === lower);
  if (!c) fail("NO_SUCH_CALENDAR", cals.map((c) => s(c.title)).join(", "));
  return c;
}
function calendarCreate(r) {
  needEvents();
  const store = eventStore();
  const e = $.EKEvent.eventWithEventStore(store);
  e.setCalendar(writableCalendar(store, r.calendar));
  e.setTitle($(r.title));
  e.setStartDate(nsDate(r.start));
  e.setEndDate(nsDate(r.end));
  e.setAllDay(!!r.allDay);
  if (r.location) e.setLocation($(r.location));
  if (r.notes) e.setNotes($(r.notes));
  if (r.dry) return { dry: true, calendar: s(e.calendar.title) };
  const err = Ref();
  if (!store.saveEventSpanCommitError(e, 0, true, err)) fail("SAVE_FAILED", errText(err));
  return { id: eventId(e), calendar: s(e.calendar.title) };
}
function calendarMove(r) {
  needEvents();
  const store = eventStore();
  const e = findEvent(store, r.id);
  if (!e) fail("GONE");
  if (!e.calendar.allowsContentModifications) fail("READ_ONLY", s(e.calendar.title));
  const was = eventOut(e);
  e.setStartDate(nsDate(r.start));
  e.setEndDate(nsDate(r.end));
  if (r.dry) return { dry: true, was: was };
  const err = Ref();
  if (!store.saveEventSpanCommitError(e, 0, true, err)) fail("SAVE_FAILED", errText(err));
  return { id: eventId(e), was: was };
}
function calendarDelete(r) {
  needEvents();
  const store = eventStore();
  const e = findEvent(store, r.id);
  if (!e) fail("GONE");
  if (!e.calendar.allowsContentModifications) fail("READ_ONLY", s(e.calendar.title));
  const was = eventOut(e);
  if (r.dry) return { dry: true, was: was };
  const err = Ref();
  if (!store.removeEventSpanCommitError(e, 0, true, err)) fail("SAVE_FAILED", errText(err));
  return { was: was };
}

// --- reminders -------------------------------------------------------------------------------
function dueOf(rem) {
  const dc = rem.dueDateComponents;
  if (!dc || dc.isNil()) return undefined;
  const d = $.NSCalendar.currentCalendar.dateFromComponents(dc);
  return isoOf(d);
}
function reminderOut(rem) {
  const out = { id: s(rem.calendarItemIdentifier), list: s(rem.calendar.title), title: s(rem.title), done: !!rem.completed };
  const due = dueOf(rem), notes = s(rem.notes);
  if (due) out.due = due;
  if (notes) out.notes = notes.slice(0, 4000);
  return out;
}
function remindersList(r) {
  needReminders();
  const store = eventStore();
  let cals = arr(store.calendarsForEntityType(1));
  if (r.list) {
    const lower = r.list.toLowerCase();
    cals = cals.filter((c) => s(c.title).toLowerCase() === lower);
    if (!cals.length) fail("NO_SUCH_LIST", arr(store.calendarsForEntityType(1)).map((c) => s(c.title)).join(", "));
  }
  const pred = r.includeDone ? store.predicateForRemindersInCalendars($(cals)) : store.predicateForIncompleteRemindersWithDueDateStartingEndingCalendars(null, null, $(cals));
  let got = null, done = false;
  // the answer comes on a background queue: keep only the array there, read it here
  store.fetchRemindersMatchingPredicateCompletion(pred, function (items) { got = items; done = true; });
  wait(() => done, 20);
  if (!done) fail("TIMEOUT");
  const out = arr(got).map(reminderOut);
  // not done first, then by due date (none last)
  out.sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : (a.due || "~") < (b.due || "~") ? -1 : (a.due || "~") > (b.due || "~") ? 1 : 0));
  return out.slice(0, r.limit);
}
function findReminder(store, id) {
  const item = store.calendarItemWithIdentifier(id);
  return item && !item.isNil() && item.isKindOfClass($.EKReminder) ? item : null;
}
function remindersGet(r) { needReminders(); const rem = findReminder(eventStore(), r.id); return rem ? reminderOut(rem) : null; }
function remindersCreate(r) {
  needReminders();
  const store = eventStore();
  let cal = store.defaultCalendarForNewReminders;
  if (r.list) {
    const lower = r.list.toLowerCase();
    const cals = arr(store.calendarsForEntityType(1)).filter((c) => c.allowsContentModifications);
    cal = cals.find((c) => s(c.title).toLowerCase() === lower);
    if (!cal) fail("NO_SUCH_LIST", cals.map((c) => s(c.title)).join(", "));
  }
  if (!cal || cal.isNil()) fail("NO_LIST");
  const rem = $.EKReminder.reminderWithEventStore(store);
  rem.setCalendar(cal);
  rem.setTitle($(r.title));
  if (r.notes) rem.setNotes($(r.notes));
  if (r.due !== undefined) {
    // year | month | day | hour | minute
    const comps = $.NSCalendar.currentCalendar.componentsFromDate(4 | 8 | 16 | 32 | 64, nsDate(r.due));
    rem.setDueDateComponents(comps);
    rem.addAlarm($.EKAlarm.alarmWithAbsoluteDate(nsDate(r.due)));
  }
  if (r.dry) return { dry: true, list: s(cal.title) };
  const err = Ref();
  if (!store.saveReminderCommitError(rem, true, err)) fail("SAVE_FAILED", errText(err));
  return { id: s(rem.calendarItemIdentifier), list: s(cal.title) };
}
function remindersComplete(r) {
  needReminders();
  const store = eventStore();
  const rem = findReminder(store, r.id);
  if (!rem) fail("GONE");
  const was = reminderOut(rem);
  if (r.dry) return { dry: true, was: was };
  rem.setCompleted(true);
  const err = Ref();
  if (!store.saveReminderCommitError(rem, true, err)) fail("SAVE_FAILED", errText(err));
  return { was: was };
}

// --- permissions -----------------------------------------------------------------------------
function status() {
  return { contacts: cnStatus(), calendars: ekStatus(0), reminders: ekStatus(1), automation: automation(false) };
}
/** shows macOS's own prompt when it hasn't asked yet; answers the status after */
function request(r) {
  if (r.what === "contacts") {
    if (cnStatus() === 0) {
      let done = false;
      $.CNContactStore.alloc.init.requestAccessForEntityTypeCompletionHandler(0, function () { done = true; });
      wait(() => done, 110);
    }
    return { code: cnStatus() };
  }
  if (r.what === "calendars" || r.what === "reminders") {
    const type = r.what === "calendars" ? 0 : 1;
    if (ekStatus(type) === 0) {
      let done = false;
      const store = eventStore();
      const cb = function () { done = true; };
      if (type === 0 && store.requestFullAccessToEventsWithCompletion) store.requestFullAccessToEventsWithCompletion(cb);
      else if (type === 1 && store.requestFullAccessToRemindersWithCompletion) store.requestFullAccessToRemindersWithCompletion(cb);
      else store.requestAccessToEntityTypeCompletion(type, cb);
      wait(() => done, 110);
    }
    return { code: ekStatus(type) };
  }
  if (r.what === "automation") return { code: automation(true) };
  fail("BAD_REQUEST");
}

function run(argv) {
  const r = JSON.parse(argv[0]);
  const ops = { status: status, request: request, contacts_all: contactsAll, calendar_list: calendarList, calendar_get: calendarGet, calendar_create: calendarCreate, calendar_move: calendarMove, calendar_delete: calendarDelete, reminders_list: remindersList, reminders_get: remindersGet, reminders_create: remindersCreate, reminders_complete: remindersComplete };
  const f = ops[r.op];
  if (!f) fail("BAD_REQUEST", r.op);
  const result = f(r);
  return JSON.stringify({ ok: true, result: result === undefined ? null : result });
}
`;

/** What the script stopped with: its code (NO_ACCESS, GONE, …) and detail. */
export class ScriptError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** Run one op of APPLE_SCRIPT. Times out (default 30 s) and caps what it reads back. */
export async function runAppleScript<T>(req: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
  const r = await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", APPLE_SCRIPT, JSON.stringify(req)], { timeoutMs });
  if (r.code !== 0) {
    const line = r.stderr.trim().split("\n").pop() ?? "";
    if (r.stderr.includes("(timed out)")) throw new ScriptError("TIMEOUT", "");
    // "execution error: Error: Error: NO_ACCESS: contacts (-2700)"
    const m = line.match(/Error: (?:Error: )?([A-Z_]+)(?:: (.*?))?(?: \(-?\d+\))?$/);
    if (m) throw new ScriptError(m[1], m[2] ?? "");
    throw new ScriptError("FAILED", line.replace(/^.*execution error: /, ""));
  }
  if (r.stdout.length > 32 * 1024 * 1024) throw new ScriptError("TOO_BIG", "");
  const out = JSON.parse(r.stdout.toString("utf8")) as { ok: true; result: T };
  return out.result;
}
