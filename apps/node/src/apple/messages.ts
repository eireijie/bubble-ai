import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppleChat, AppleMessage, ApplePermission } from "@wisp/core";
import { exec } from "../computers/driver.ts";
import { decodeAttributedBodyHex } from "./typedstream.ts";
import { MS_SQL, appleMsToIso, chatName, cleanText, handleKey, isGroup, likePattern, nameOf, sqlString, unixMsToAppleDate, type ChatRow } from "./util.ts";

/**
 * Messages, read straight from ~/Library/Messages/chat.db (read-only, with the sqlite3 that ships
 * with macOS, so no native modules), and sent through the Messages app with AppleScript.
 */

export const CHAT_DB = path.join(os.homedir(), "Library", "Messages", "chat.db");
const SQLITE = "/usr/bin/sqlite3";
/** at most this much of a body's archive comes back (hex chars): 32 KB of text */
const BODY_HEX_MAX = 65_536;
/** a normal message: not a tapback/reaction, not a group rename or someone joining */
const NORMAL = "COALESCE(m.associated_message_type, 0) = 0 AND COALESCE(m.item_type, 0) = 0";

export class DbError extends Error {
  constructor(
    readonly kind: "no_access" | "missing" | "failed",
    message: string,
  ) {
    super(message);
  }
}

/** Run a read-only query; rows as objects. */
export async function query<T>(sql: string, db = CHAT_DB, timeoutMs = 20_000): Promise<T[]> {
  if (!fs.existsSync(db)) throw new DbError("missing", "no Messages database");
  const r = await exec(SQLITE, ["-readonly", "-json", "-cmd", ".timeout 3000", db, sql], { timeoutMs });
  if (r.code !== 0) {
    const err = r.stderr.trim();
    if (/authorization denied|not authorized|operation not permitted/i.test(err)) throw new DbError("no_access", err);
    throw new DbError("failed", err.split("\n").pop() || "sqlite3 failed");
  }
  const out = r.stdout.toString("utf8").trim();
  return out ? (JSON.parse(out) as T[]) : [];
}

/** Can this process read chat.db? (Full Disk Access; checking never prompts.) */
export async function fullDiskAccess(db = CHAT_DB): Promise<ApplePermission> {
  try {
    await query("SELECT 1 FROM message LIMIT 1", db, 10_000);
    return "allowed";
  } catch (err) {
    if (err instanceof DbError && err.kind === "no_access") return "denied";
    return "unknown";
  }
}

// --- rows --------------------------------------------------------------------------------------

interface RawChat {
  rowid: number;
  guid: string;
  ident: string | null;
  dname: string | null;
  style: number | null;
  svc: string | null;
  handles: string | null;
}

interface RawMessage {
  ms: number;
  me: number;
  text: string | null;
  body: string | null;
  att: number | null;
  sender: string | null;
  chat: number;
}

const toChat = (r: RawChat): ChatRow => ({
  rowid: r.rowid,
  guid: r.guid,
  ident: r.ident ?? "",
  displayName: r.dname ?? "",
  style: r.style ?? 45,
  service: r.svc ?? "",
  handles: r.handles ? r.handles.split("\u001f").filter(Boolean) : [],
});

/** Every conversation (id, name, people), for resolving names and numbers. */
export async function allChats(db = CHAT_DB): Promise<ChatRow[]> {
  const rows = await query<RawChat>(
    `SELECT c.ROWID AS rowid, c.guid AS guid, c.chat_identifier AS ident, c.display_name AS dname, c.style AS style, c.service_name AS svc,
       (SELECT group_concat(h.id, char(31)) FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = c.ROWID) AS handles
     FROM chat c LIMIT 20000`,
    db,
  );
  return rows.map(toChat);
}

const MESSAGE_COLUMNS = `${MS_SQL("m.date")} AS ms, m.is_from_me AS me, m.text AS text,
  CASE WHEN m.text IS NULL OR m.text = '' THEN substr(hex(m.attributedBody), 1, ${BODY_HEX_MAX}) END AS body,
  m.cache_has_attachments AS att, h.id AS sender`;

const textOf = (m: RawMessage) => cleanText(m.text || decodeAttributedBodyHex(m.body), !!m.att);

/** Each chat's newest normal message: the chats with the newest first. */
async function latestPerChat(limit: number, sinceUnixMs: number | null, db: string): Promise<(RawMessage & { chat: number })[]> {
  const since = sinceUnixMs === null ? "" : `WHERE last >= ${unixMsToAppleDate(sinceUnixMs)}`;
  return query<RawMessage>(
    `WITH recent AS (
       SELECT chat_id, max(message_date) AS last FROM chat_message_join GROUP BY chat_id
     ), picked AS (
       SELECT r.chat_id, r.last,
         (SELECT j.message_id FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id
          WHERE j.chat_id = r.chat_id AND ${NORMAL} ORDER BY j.message_date DESC LIMIT 1) AS mid
       FROM (SELECT * FROM recent ${since} ORDER BY last DESC LIMIT ${Math.trunc(limit) * 2}) r
     )
     SELECT p.chat_id AS chat, ${MESSAGE_COLUMNS}
     FROM picked p JOIN message m ON m.ROWID = p.mid LEFT JOIN handle h ON h.ROWID = m.handle_id
     ORDER BY p.last DESC`,
    db,
  );
}

function chatOut(c: ChatRow, last: RawMessage, names: Map<string, string>): AppleChat {
  return { chatId: c.guid, name: chatName(c, names), handles: c.handles, isGroup: isGroup(c), lastText: textOf(last), lastAt: appleMsToIso(last.ms), lastFromMe: !!last.me };
}

/**
 * Recent conversations, newest first. A person's iMessage and SMS chats show as one (the newer).
 */
export async function recentChats(limit: number, chats: ChatRow[], names: Map<string, string>, db = CHAT_DB): Promise<AppleChat[]> {
  const byRow = new Map(chats.map((c) => [c.rowid, c]));
  const rows = await latestPerChat(limit, null, db);
  const out: AppleChat[] = [];
  const people = new Set<string>();
  for (const r of rows) {
    const c = byRow.get(r.chat);
    if (!c) continue;
    if (!isGroup(c)) {
      const key = c.handles[0] ? handleKey(c.handles[0]) : null;
      if (key && people.has(key)) continue;
      if (key) people.add(key);
    }
    out.push(chatOut(c, r, names));
    if (out.length >= limit) break;
  }
  return out;
}

/** One conversation's latest messages, oldest first. */
export async function readChats(target: ChatRow[], limit: number, names: Map<string, string>, db = CHAT_DB): Promise<AppleMessage[]> {
  const ids = target.map((c) => Math.trunc(c.rowid)).join(",");
  const rows = await query<RawMessage>(
    `SELECT j.chat_id AS chat, ${MESSAGE_COLUMNS}
     FROM chat_message_join j JOIN message m ON m.ROWID = j.message_id LEFT JOIN handle h ON h.ROWID = m.handle_id
     WHERE j.chat_id IN (${ids}) AND ${NORMAL}
     ORDER BY j.message_date DESC LIMIT ${Math.trunc(limit)}`,
    db,
  );
  return rows.reverse().map((m) => ({ at: appleMsToIso(m.ms), fromMe: !!m.me, sender: m.me ? "me" : m.sender ? nameOf(m.sender, names) : "them", text: textOf(m) }));
}

/** Messages containing `q` (any case), newest first, with their conversation. */
export async function searchMessages(q: string, limit: number, chats: ChatRow[], names: Map<string, string>, db = CHAT_DB): Promise<AppleMessage[]> {
  // bodies only in the archive can't be LIKE'd (it holds NULs): find the bytes in a few cases, then check after decoding
  const forms = [...new Set([q, q.toLowerCase(), q.toUpperCase(), q.charAt(0).toUpperCase() + q.slice(1).toLowerCase()])];
  const inBlob = forms.map((f) => `instr(m.attributedBody, CAST(${sqlString(f)} AS BLOB)) > 0`).join(" OR ");
  const rows = await query<RawMessage>(
    `SELECT j.chat_id AS chat, ${MESSAGE_COLUMNS}
     FROM message m JOIN chat_message_join j ON j.message_id = m.ROWID LEFT JOIN handle h ON h.ROWID = m.handle_id
     WHERE ${NORMAL} AND (m.text LIKE ${likePattern(q)} OR ((m.text IS NULL OR m.text = '') AND (${inBlob})))
     ORDER BY m.date DESC LIMIT ${Math.trunc(limit) * 3}`,
    db,
    30_000,
  );
  const byRow = new Map(chats.map((c) => [c.rowid, c]));
  const needle = q.toLowerCase();
  const out: AppleMessage[] = [];
  for (const m of rows) {
    const text = textOf(m);
    if (!text.toLowerCase().includes(needle)) continue;
    const c = byRow.get(m.chat);
    out.push({ at: appleMsToIso(m.ms), fromMe: !!m.me, sender: m.me ? "me" : m.sender ? nameOf(m.sender, names) : "them", text, chatId: c?.guid, chatName: c ? chatName(c, names) : undefined });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * One-to-one conversations whose newest message is from them, between `minHours` and `maxHours`
 * old, oldest wait first. A person's iMessage and SMS chats count as one.
 */
export async function unansweredChats(minHours: number, maxHours: number, chats: ChatRow[], names: Map<string, string>, now = Date.now(), db = CHAT_DB): Promise<AppleChat[]> {
  const rows = await latestPerChat(500, now - maxHours * 3_600_000, db);
  const byRow = new Map(chats.map((c) => [c.rowid, c]));
  const newest = new Map<string, { c: ChatRow; m: RawMessage }>();
  for (const r of rows) {
    const c = byRow.get(r.chat);
    if (!c || isGroup(c)) continue;
    const key = (c.handles[0] && handleKey(c.handles[0])) || c.guid;
    const seen = newest.get(key);
    if (!seen || r.ms > seen.m.ms) newest.set(key, { c, m: r });
  }
  return pickUnanswered([...newest.values()], minHours, maxHours, now).map(({ c, m }) => chatOut(c, m, names));
}

/** The pure part of `unansweredChats`. */
export function pickUnanswered<T extends { m: { ms: number; me: number } }>(latest: T[], minHours: number, maxHours: number, now: number): T[] {
  return latest
    .filter(({ m }) => {
      if (m.me) return false;
      const ageH = (now - (Date.parse(appleMsToIso(m.ms)))) / 3_600_000;
      return ageH >= minHours && ageH <= maxHours;
    })
    .sort((a, b) => a.m.ms - b.m.ms);
}

// --- sending -----------------------------------------------------------------------------------

/** Sends `text` to a handle on the iMessage or SMS account. Handle and text come in on argv. */
export const SEND_SCRIPT = `on run argv
  set theHandle to item 1 of argv
  set theText to item 2 of argv
  set theKind to item 3 of argv
  tell application "Messages"
    if theKind is "sms" then
      set theAccount to 1st account whose service type = SMS
    else if theKind is "rcs" then
      set theAccount to 1st account whose service type = RCS
    else
      set theAccount to 1st account whose service type = iMessage
    end if
    set thePerson to participant theHandle of theAccount
    send theText to thePerson
  end tell
  return "sent"
end run`;

export type SendService = "imessage" | "sms" | "rcs";

/** iMessage unless the newest chat with them is SMS or RCS. */
export function sendService(to: string, chats: ChatRow[]): SendService {
  const key = handleKey(to);
  const mine = chats.filter((c) => !isGroup(c) && c.handles.some((h) => handleKey(h) === key));
  // higher ROWID = made later
  const newest = mine.sort((a, b) => b.rowid - a.rowid)[0];
  const svc = newest?.service.toLowerCase();
  return svc === "sms" || svc === "rcs" ? svc : "imessage";
}

export class SendError extends Error {
  constructor(
    readonly kind: "not_allowed" | "no_account" | "failed",
    message: string,
  ) {
    super(message);
  }
}

/** Send a text. `dry`: only compile the script (nothing is sent). */
export async function sendText(to: string, text: string, service: SendService, dry = false): Promise<void> {
  if (dry) {
    const out = path.join(os.tmpdir(), `wisp-send-check-${process.pid}.scpt`);
    try {
      const r = await exec("/usr/bin/osacompile", ["-o", out, "-e", SEND_SCRIPT], { timeoutMs: 20_000 });
      if (r.code !== 0) throw new SendError("failed", r.stderr.trim());
    } finally {
      fs.rmSync(out, { force: true });
    }
    return;
  }
  const r = await exec("/usr/bin/osascript", ["-e", SEND_SCRIPT, to, text, service], { timeoutMs: 30_000 });
  if (r.code === 0) return;
  const err = r.stderr;
  if (/-1743|not authori[sz]ed to send apple events/i.test(err)) throw new SendError("not_allowed", err);
  if (/-1728|can.t get account|can.t get participant/i.test(err)) throw new SendError("no_account", err);
  throw new SendError("failed", err.trim().split("\n").pop() ?? "osascript failed");
}
