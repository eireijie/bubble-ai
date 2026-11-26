import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppleOp, type AppleContact } from "@bubble-ai/core";
import { decodeAttributedBody, decodeAttributedBodyHex } from "./typedstream.ts";
import { APPLE_EPOCH_MS, appleDateToMs, appleMsToIso, automationPermission, chatName, cleanText, contactsPermission, eventKitPermission, handleKey, likePattern, nameIndex, permissionHolder, resolveChat, searchContacts, sqlString, unixMsToAppleDate, type ChatRow } from "./util.ts";
import { allChats, fullDiskAccess, pickUnanswered, readChats, recentChats, searchMessages, sendService, unansweredChats } from "./messages.ts";
import { iconFileName } from "./icons.ts";
import { APPLE_SCRIPT } from "./jxa.ts";
import { AppleBridge, AppleError } from "./index.ts";

// Made on a Mac with NSArchiver from NSMutableAttributedString, the format Messages keeps in attributedBody.
const ARCHIVED = {
  short: "BAtzdHJlYW10eXBlZIHoA4QBQISEhBlOU011dGFibGVBdHRyaWJ1dGVkU3RyaW5nAISEEk5TQXR0cmlidXRlZFN0cmluZwCEhAhOU09iamVjdACFkoSEhA9OU011dGFibGVTdHJpbmcBhIQITlNTdHJpbmcBlYQBKwtIZWxsbyB0aGVyZYaEAmlJAQuShISEDE5TRGljdGlvbmFyeQCVhAFpAIaG",
  emoji: "BAtzdHJlYW10eXBlZIHoA4QBQISEhBlOU011dGFibGVBdHRyaWJ1dGVkU3RyaW5nAISEEk5TQXR0cmlidXRlZFN0cmluZwCEhAhOU09iamVjdACFkoSEhA9OU011dGFibGVTdHJpbmcBhIQITlNTdHJpbmcBlYQBKxRPbiBteSB3YXkg8J+alyBjYWbDqYaEAmlJARGShISEDE5TRGljdGlvbmFyeQCVhAFpAIaG",
  n200: "BAtzdHJlYW10eXBlZIHoA4QBQISEhBlOU011dGFibGVBdHRyaWJ1dGVkU3RyaW5nAISEEk5TQXR0cmlidXRlZFN0cmluZwCEhAhOU09iamVjdACFkoSEhA9OU011dGFibGVTdHJpbmcBhIQITlNTdHJpbmcBlYQBK4HIAHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4hoQCaUkBgcgAkoSEhAxOU0RpY3Rpb25hcnkAlYQBaQCGhg==",
};

/** An attributedBody the way Messages writes it (immutable NSString), around `text`. */
function messagesBody(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  let len: Buffer;
  if (bytes.length < 0x80) len = Buffer.from([bytes.length]);
  else if (bytes.length < 0x10000) len = Buffer.concat([Buffer.from([0x81]), Buffer.from(new Uint16Array([bytes.length]).buffer)]);
  else {
    len = Buffer.alloc(5);
    len[0] = 0x82;
    len.writeUInt32LE(bytes.length, 1);
  }
  const head = Buffer.concat([
    Buffer.from([0x04, 0x0b]),
    Buffer.from("streamtyped"),
    Buffer.from([0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84, 0x12]),
    Buffer.from("NSAttributedString"),
    Buffer.from([0x00, 0x84, 0x84, 0x08]),
    Buffer.from("NSObject"),
    Buffer.from([0x00, 0x85, 0x92, 0x84, 0x84, 0x84, 0x08]),
    Buffer.from("NSString"),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
  ]);
  const tail = Buffer.concat([Buffer.from([0x86, 0x84, 0x02, 0x69, 0x49, 0x01, 0x05, 0x92, 0x84, 0x84, 0x84, 0x0c]), Buffer.from("NSDictionary"), Buffer.from([0x00, 0x94, 0x84, 0x01, 0x69, 0x01, 0x92, 0x84, 0x96, 0x96, 0x1d]), Buffer.from("__kIMMessagePartAttributeName"), Buffer.from([0x86, 0x86])]);
  return Buffer.concat([head, len, bytes, tail]);
}

describe("attributedBody (typedstream)", () => {
  it("reads archives NSArchiver made", () => {
    expect(decodeAttributedBody(Buffer.from(ARCHIVED.short, "base64"))).toBe("Hello there");
    expect(decodeAttributedBody(Buffer.from(ARCHIVED.emoji, "base64"))).toBe("On my way 🚗 café");
    expect(decodeAttributedBody(Buffer.from(ARCHIVED.n200, "base64"))).toBe("x".repeat(200));
  });
  it("reads Messages' own layout, with one-, two- and four-byte lengths", () => {
    expect(decodeAttributedBody(messagesBody("ok"))).toBe("ok");
    const mid = "é".repeat(300);
    expect(decodeAttributedBody(messagesBody(mid))).toBe(mid);
    const long = "long ".repeat(15_000);
    expect(decodeAttributedBody(messagesBody(long))).toBe(long);
  });
  it("takes the body, not the attribute names after it", () => {
    expect(decodeAttributedBody(messagesBody("first"))).toBe("first");
  });
  it("keeps what's there of a cut-off body, without a broken last character", () => {
    const full = messagesBody("abc😀def");
    const cut = full.subarray(0, full.indexOf(Buffer.from("😀")) + 2);
    expect(decodeAttributedBody(cut)).toBe("abc");
  });
  it("reads hex as sqlite returns it", () => {
    expect(decodeAttributedBodyHex(messagesBody("hex me").toString("hex").toUpperCase())).toBe("hex me");
  });
  it("returns null for nothing or junk", () => {
    expect(decodeAttributedBody(null)).toBeNull();
    expect(decodeAttributedBody(Buffer.alloc(0))).toBeNull();
    expect(decodeAttributedBody(Buffer.from("not an archive"))).toBeNull();
    expect(decodeAttributedBody(Buffer.from("xxNSString\x01\x94\x84\x01\x2b\x83", "latin1"))).toBeNull();
    expect(decodeAttributedBodyHex(null)).toBeNull();
  });
});

describe("Apple dates", () => {
  it("converts nanoseconds and old seconds since 2001", () => {
    // 2024-01-01T00:00:00Z
    const unix = Date.UTC(2024, 0, 1);
    const ns = BigInt(unix - APPLE_EPOCH_MS) * 1_000_000n;
    expect(appleMsToIso(appleDateToMs(ns))).toBe("2024-01-01T00:00:00.000Z");
    expect(appleMsToIso(appleDateToMs((unix - APPLE_EPOCH_MS) / 1000))).toBe("2024-01-01T00:00:00.000Z");
    expect(unixMsToAppleDate(unix)).toBe(ns.toString());
    expect(appleMsToIso(0)).toBe("2001-01-01T00:00:00.000Z");
  });
});

describe("handles", () => {
  it("normalizes phone numbers to their last 10 digits", () => {
    expect(handleKey("+1 (555) 123-4567")).toBe("5551234567");
    expect(handleKey("555.123.4567")).toBe("5551234567");
    expect(handleKey("tel:+15551234567")).toBe("5551234567");
    expect(handleKey("+44 20 7946 0958")).toBe("2079460958");
    expect(handleKey("12345")).toBe("12345");
  });
  it("lower-cases emails", () => {
    expect(handleKey(" Sam@Example.COM ")).toBe("sam@example.com");
    expect(handleKey("mailto:a@b.co")).toBe("a@b.co");
  });
  it("isn't fooled by names", () => {
    expect(handleKey("Sam")).toBeNull();
    expect(handleKey("Sam 2")).toBeNull();
    expect(handleKey("1234")).toBeNull();
    expect(handleKey("not @ email")).toBeNull();
  });
});

const chats: ChatRow[] = [
  { rowid: 1, guid: "iMessage;-;+15551234567", ident: "+15551234567", displayName: "", style: 45, service: "iMessage", handles: ["+15551234567"] },
  { rowid: 2, guid: "SMS;-;+15551234567", ident: "+15551234567", displayName: "", style: 45, service: "SMS", handles: ["+15551234567"] },
  { rowid: 3, guid: "iMessage;+;chat1", ident: "chat1", displayName: "Climbing", style: 43, service: "iMessage", handles: ["+15551234567", "kim@example.com"] },
  { rowid: 4, guid: "iMessage;-;kim@example.com", ident: "kim@example.com", displayName: "", style: 45, service: "iMessage", handles: ["kim@example.com"] },
  { rowid: 5, guid: "iMessage;-;+15550001111", ident: "+15550001111", displayName: "", style: 45, service: "iMessage", handles: ["+15550001111"] },
  { rowid: 6, guid: "RCS;-;+15552223333", ident: "+15552223333", displayName: "", style: 45, service: "RCS", handles: ["+15552223333"] },
];
const people = [
  { name: "Sam Lee", phones: ["(555) 123-4567"], emails: [] },
  { name: "Kim Park", phones: [], emails: ["Kim@Example.com"] },
  { name: "Sam Ortiz", phones: ["555-000-1111"], emails: [] },
];

describe("which chat", () => {
  const ids = (r: ReturnType<typeof resolveChat>) => (r.ok ? r.chats.map((c) => c.rowid).sort() : r.error);
  it("takes a chat id, with the same person's other chats", () => {
    expect(ids(resolveChat("iMessage;-;+15551234567", chats, []))).toEqual([1, 2]);
    expect(ids(resolveChat("iMessage;+;chat1", chats, []))).toEqual([3]);
  });
  it("takes a phone number in any format, or an email", () => {
    expect(ids(resolveChat("555 123 4567", chats, []))).toEqual([1, 2]);
    expect(ids(resolveChat("KIM@example.com", chats, []))).toEqual([4]);
    expect(resolveChat("+1 999 999 9999", chats, []).ok).toBe(false);
  });
  it("takes a contact's name, and asks when it's ambiguous", () => {
    expect(ids(resolveChat("Kim Park", chats, people))).toEqual([4]);
    expect(ids(resolveChat("kim", chats, people))).toEqual([4]);
    expect(ids(resolveChat("Ortiz", chats, people))).toEqual([5]);
    const two = resolveChat("Sam", chats, people);
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error).toMatch(/Sam Lee, Sam Ortiz/);
    expect(ids(resolveChat("Sam Lee", chats, people))).toEqual([1, 2]);
  });
  it("takes a group's name", () => {
    expect(ids(resolveChat("climbing", chats, people))).toEqual([3]);
  });
  it("says names need Contacts when it has none", () => {
    const r = resolveChat("Sam", chats, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Contacts/);
  });
  it("names chats after contacts", () => {
    const names = nameIndex(people);
    expect(chatName(chats[0], names)).toBe("Sam Lee");
    expect(chatName(chats[2], names)).toBe("Climbing");
    expect(chatName({ ...chats[2], displayName: "" }, names)).toBe("Sam Lee, Kim Park");
  });
  it("sends on the service the person's newest chat uses", () => {
    expect(sendService("+15551234567", chats)).toBe("sms");
    expect(sendService("kim@example.com", chats)).toBe("imessage");
    expect(sendService("+15552223333", chats)).toBe("rcs");
    expect(sendService("+15559999999", chats)).toBe("imessage");
  });
});

describe("contacts search", () => {
  const list: AppleContact[] = [
    { id: "1", name: "Sam Lee", phones: ["+1 (555) 123-4567"], emails: ["sam@work.com"], organization: "Acme" },
    { id: "2", name: "Samantha Ray", phones: ["555 987 6543"], emails: [] },
    { id: "3", name: "Bo Sam", phones: [], emails: ["BO@Example.com"] },
  ];
  it("matches phone numbers and emails normalized", () => {
    expect(searchContacts(list, "5551234567", 10).map((c) => c.id)).toEqual(["1"]);
    expect(searchContacts(list, "+15551234567", 10).map((c) => c.id)).toEqual(["1"]);
    expect(searchContacts(list, "bo@example.com", 10).map((c) => c.id)).toEqual(["3"]);
    expect(searchContacts(list, "987 65", 10).map((c) => c.id)).toEqual(["2"]);
  });
  it("ranks names: exact, starts with, a word, contains, company", () => {
    expect(searchContacts(list, "sam", 10).map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(searchContacts(list, "acme", 10).map((c) => c.id)).toEqual(["1"]);
    expect(searchContacts(list, "sam", 1)).toHaveLength(1);
  });
});

describe("small pieces", () => {
  it("quotes SQL", () => {
    expect(sqlString("it's")).toBe("'it''s'");
    expect(sqlString("a\0b")).toBe("'ab'");
    expect(likePattern("50%_off")).toBe("'%50\\%\\_off%' ESCAPE '\\'");
  });
  it("cleans message text", () => {
    expect(cleanText("￼", true)).toBe("[attachment]");
    expect(cleanText(" hi ￼", true)).toBe("hi");
    expect(cleanText("x".repeat(10), false, 4)).toBe("xxxx…");
  });
  it("maps permission codes", () => {
    expect([0, 1, 2, 3, 4, 9].map(contactsPermission)).toEqual(["not_asked", "denied", "denied", "allowed", "allowed", "unknown"]);
    expect([0, 1, 2, 3, 4].map(eventKitPermission)).toEqual(["not_asked", "denied", "denied", "allowed", "denied"]);
    expect([0, -1743, -1744, -600].map(automationPermission)).toEqual(["allowed", "denied", "not_asked", null]);
  });
  it("names who holds the permissions", () => {
    const plist = "<key>CFBundleName</key><string>Bubble AI</string>";
    expect(permissionHolder("/Applications/wisp.app/Contents/MacOS/wisp", {}, () => plist)).toBe("Bubble AI");
    expect(permissionHolder("/Applications/wisp.app/Contents/MacOS/wisp", {}, () => { throw new Error("no"); })).toBe("wisp");
    expect(permissionHolder("/opt/homebrew/bin/node", { XPC_SERVICE_NAME: "ai.wisp.node" }, undefined, () => null)).toBe("node (/opt/homebrew/bin/node)");
    expect(permissionHolder("/opt/homebrew/bin/node", { TERM_PROGRAM: "Apple_Terminal" }, undefined, () => null)).toBe("Terminal");
    expect(permissionHolder("/opt/homebrew/bin/node", { TERM_PROGRAM: "iTerm.app", XPC_SERVICE_NAME: "0" }, undefined, () => null)).toBe("iTerm");
    // started by another app (the Claude app, an editor): macOS credits that app
    expect(permissionHolder("/opt/homebrew/bin/node", { TERM_PROGRAM: "Apple_Terminal" }, undefined, () => "Claude")).toBe("Claude");
  });
  it("finds an app's icon file", () => {
    expect(iconFileName("<key>CFBundleIconFile</key>\n\t<string>AppIcon</string>")).toBe("AppIcon.icns");
    expect(iconFileName("<key>CFBundleIconFile</key><string>Contacts.icns</string>")).toBe("Contacts.icns");
    expect(iconFileName("<dict/>")).toBeNull();
  });
  it("picks unanswered chats by age, oldest wait first", () => {
    const now = Date.UTC(2026, 0, 2);
    const at = (h: number) => now - h * 3_600_000 - APPLE_EPOCH_MS;
    const rows = [
      { id: "a", m: { ms: at(1), me: 0 } },
      { id: "b", m: { ms: at(5), me: 0 } },
      { id: "c", m: { ms: at(6), me: 1 } },
      { id: "d", m: { ms: at(30), me: 0 } },
      { id: "e", m: { ms: at(10), me: 0 } },
    ];
    expect(pickUnanswered(rows, 2, 24, now).map((r) => r.id)).toEqual(["e", "b"]);
  });
});

describe("ops", () => {
  it("validates what the hub asks", () => {
    expect(AppleOp.safeParse({ op: "messages_read", chat: "Sam", limit: 20 }).success).toBe(true);
    expect(AppleOp.safeParse({ op: "messages_read", chat: "", limit: 20 }).success).toBe(false);
    expect(AppleOp.safeParse({ op: "messages_recent", limit: 500 }).success).toBe(false);
    expect(AppleOp.safeParse({ op: "calendar_get", id: "abc" }).success).toBe(true);
    expect(AppleOp.safeParse({ op: "reminders_get", id: "" }).success).toBe(false);
    expect(AppleOp.safeParse({ op: "calendar_list", from: "yesterday", to: "2026-01-01T00:00:00Z", limit: 5 }).success).toBe(false);
    expect(AppleOp.safeParse({ op: "rm_rf" }).success).toBe(false);
  });
  it("turns a bad op into plain words", async () => {
    const bridge = new AppleBridge("/nonexistent/chat.db", "Bubble AI");
    await expect(bridge.handle({ op: "messages_send", to: "x" })).rejects.toBeInstanceOf(AppleError);
    await expect(bridge.handle({ op: "messages_read", chat: "Sam", limit: 0 })).rejects.toThrow(/isn't something Bubble AI can do/);
  });
  it("checks ranges and handles before touching anything", async () => {
    const bridge = new AppleBridge("/nonexistent/chat.db", "Bubble AI");
    await expect(bridge.handle({ op: "messages_unanswered", minHours: 30, maxHours: 2 })).rejects.toThrow(/shortest wait/);
    await expect(bridge.handle({ op: "messages_send", to: "Sam Lee", text: "hi" })).rejects.toThrow(/isn't a phone number or email/);
    await expect(bridge.handle({ op: "calendar_create", title: "x", start: "2026-01-02T00:00:00Z", end: "2026-01-01T00:00:00Z" })).rejects.toThrow(/end before it starts/);
  });
  it("says Messages has no history when there's no database", async () => {
    const bridge = new AppleBridge("/nonexistent/chat.db", "Bubble AI");
    await expect(bridge.handle({ op: "messages_recent", limit: 5 })).rejects.toThrow(/no Messages history/);
  });
  it("puts no request text into the script itself", () => {
    // requests travel on argv as JSON; the script parses them
    expect(APPLE_SCRIPT).toContain("JSON.parse(argv[0])");
  });
});

// A small chat.db with Messages' tables, read through the real sqlite3 queries.
const SQLITE = "/usr/bin/sqlite3";
describe.skipIf(process.platform !== "darwin" || !fs.existsSync(SQLITE))("reading a Messages database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wisp-chatdb-"));
  const db = path.join(dir, "chat.db");
  const now = Date.now();
  const ns = (hoursAgo: number) => unixMsToAppleDate(now - hoursAgo * 3_600_000);
  const rows: [number, number, string | null, Buffer | null, number, string, number, number, number][] = [
    // rowid, handle, text, body, fromMe, date(ns), chat, assocType, attachments
    [1, 1, "hey are you around", null, 0, ns(50), 1, 0, 0],
    [2, 0, "yes! what's up", null, 1, ns(49), 1, 0, 0],
    [3, 1, null, messagesBody("Dinner on Friday? 🍕"), 0, ns(5), 2, 0, 0],
    [4, 1, "Loved “Dinner”", null, 0, ns(4), 2, 2000, 0],
    [5, 2, "pics from the trip", null, 0, ns(3), 3, 0, 1],
    [6, 0, "￼", null, 1, ns(2), 4, 0, 1],
    [7, 3, null, messagesBody("Can you call me back"), 0, ns(30), 5, 0, 0],
  ];
  const sql = [
    "CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);",
    "CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT, style INTEGER, service_name TEXT);",
    "CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, handle_id INTEGER, is_from_me INTEGER, date INTEGER, associated_message_type INTEGER, item_type INTEGER, cache_has_attachments INTEGER);",
    "CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER);",
    "CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);",
    "INSERT INTO handle VALUES (1,'+15551234567','iMessage'),(2,'kim@example.com','iMessage'),(3,'+15550001111','SMS');",
    "INSERT INTO chat VALUES (1,'iMessage;-;+15551234567','+15551234567','',45,'iMessage'),(2,'SMS;-;+15551234567','+15551234567','',45,'SMS'),(3,'iMessage;+;chat9','chat9','Trip',43,'iMessage'),(4,'iMessage;-;kim@example.com','kim@example.com','',45,'iMessage'),(5,'SMS;-;+15550001111','+15550001111','',45,'SMS');",
    "INSERT INTO chat_handle_join VALUES (1,1),(2,1),(3,1),(3,2),(4,2),(5,3);",
    ...rows.map(([id, h, text, body, me, date, , assoc, att]) => `INSERT INTO message VALUES (${id},${text === null ? "NULL" : sqlString(text)},${body ? `X'${body.toString("hex")}'` : "NULL"},${h},${me},${date},${assoc},0,${att});`),
    ...rows.map(([id, , , , , date, chat]) => `INSERT INTO chat_message_join VALUES (${chat},${id},${date});`),
  ].join("\n");
  execFileSync(SQLITE, [db], { input: sql });
  const names = nameIndex(people);

  it("reports access", async () => {
    expect(await fullDiskAccess(db)).toBe("allowed");
    expect(await fullDiskAccess(path.join(dir, "none.db"))).toBe("unknown");
  });
  it("lists recent chats, one per person, skipping tapbacks", async () => {
    const all = await allChats(db);
    const recent = await recentChats(10, all, names, db);
    expect(recent.map((c) => c.chatId)).toEqual(["iMessage;-;kim@example.com", "iMessage;+;chat9", "SMS;-;+15551234567", "SMS;-;+15550001111"]);
    expect(recent[0]).toMatchObject({ name: "Kim Park", lastText: "[attachment]", lastFromMe: true, isGroup: false });
    expect(recent[1]).toMatchObject({ name: "Trip", isGroup: true, lastText: "pics from the trip" });
    expect(recent[2]).toMatchObject({ name: "Sam Lee", lastText: "Dinner on Friday? 🍕", lastFromMe: false });
    expect(recent[2].lastAt).toBe(new Date(now - 5 * 3_600_000).toISOString());
  });
  it("reads a person's chats together, oldest first", async () => {
    const all = await allChats(db);
    const r = resolveChat("Sam Lee", all, people);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const msgs = await readChats(r.chats, 10, names, db);
    expect(msgs.map((m) => m.text)).toEqual(["hey are you around", "yes! what's up", "Dinner on Friday? 🍕"]);
    expect(msgs.map((m) => m.sender)).toEqual(["Sam Lee", "me", "Sam Lee"]);
    expect((await readChats(r.chats, 1, names, db)).map((m) => m.text)).toEqual(["Dinner on Friday? 🍕"]);
  });
  it("searches plain and archived text, any case", async () => {
    const all = await allChats(db);
    expect((await searchMessages("dinner", 10, all, names, db)).map((m) => [m.text, m.chatName])).toEqual([["Dinner on Friday? 🍕", "Sam Lee"]]);
    expect((await searchMessages("CALL ME", 10, all, names, db)).map((m) => m.text)).toEqual(["Can you call me back"]);
    expect((await searchMessages("trip", 10, all, names, db)).map((m) => m.chatId)).toEqual(["iMessage;+;chat9"]);
    expect(await searchMessages("it's 100%", 10, all, names, db)).toEqual([]);
  });
  it("finds texts waiting on an answer", async () => {
    const all = await allChats(db);
    const waiting = await unansweredChats(1, 48, all, names, now, db);
    expect(waiting.map((c) => c.chatId)).toEqual(["SMS;-;+15550001111", "SMS;-;+15551234567"]);
    expect((await unansweredChats(1, 10, all, names, now, db)).map((c) => c.name)).toEqual(["Sam Lee"]);
  });
});

describe("the Mac script", () => {
  it("never hands null to a framework call (JXA makes it NSNull, which EventKit answers with nothing or an error)", () => {
    // every line that calls into a framework (store.…, $.…) and passes null as an argument
    const lines = APPLE_SCRIPT.split("\n").filter((l) => /(store|\$)\.[a-z][A-Za-z]*\(/.test(l));
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.filter((l) => /[(,]\s*null\s*[,)]/.test(l))).toEqual([]);
  });
  it("finds contacts with one fetch over all of them, not by container", () => {
    expect(APPLE_SCRIPT).toContain("enumerateContactsWithFetchRequestErrorUsingBlock");
    expect(APPLE_SCRIPT).not.toContain("containersMatchingPredicateError");
  });
});
