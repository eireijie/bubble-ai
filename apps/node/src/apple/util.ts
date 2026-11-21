import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AppleContact, ApplePermission } from "@wisp/core";

/** 2001-01-01T00:00:00Z, where Apple's dates count from. */
export const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

/** Milliseconds since 2001 (what our queries select) → ISO time. */
export function appleMsToIso(ms: number): string {
  return new Date(APPLE_EPOCH_MS + ms).toISOString();
}

/**
 * A `message.date` → milliseconds since 2001. Since macOS 10.13 it's nanoseconds; older
 * databases kept seconds.
 */
export function appleDateToMs(date: number | bigint): number {
  const n = typeof date === "bigint" ? date : BigInt(Math.trunc(date));
  return n > 100_000_000_000n ? Number(n / 1_000_000n) : Number(n) * 1000;
}

/** A Unix time (ms) as a `message.date` (nanoseconds since 2001), written out for SQL. */
export function unixMsToAppleDate(unixMs: number): string {
  return (BigInt(Math.round(unixMs - APPLE_EPOCH_MS)) * 1_000_000n).toString();
}

/** SQL for a message's time in ms since 2001, whichever unit the database used. */
export const MS_SQL = (col: string) => `(CASE WHEN ${col} > 100000000000 THEN ${col} / 1000000 ELSE ${col} * 1000 END)`;

/** A string as a SQLite literal (SQLite has no backslash escapes, so doubling quotes is enough). */
export function sqlString(s: string): string {
  return `'${s.replace(/\0/g, "").replace(/'/g, "''")}'`;
}

/** A string for `LIKE … ESCAPE '\'`. */
export function likePattern(s: string): string {
  return sqlString(`%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) + ` ESCAPE '\\'`;
}

/**
 * The part of a handle that identifies a person: an email in lower case, or a phone number's
 * last 10 digits (so +1 555 123 4567, (555) 123-4567 and 5551234567 match). Null for anything
 * that's neither.
 */
export function handleKey(raw: string): string | null {
  const s = raw.trim().replace(/^(tel|mailto|sms|imessage):/i, "").trim();
  if (s.includes("@")) {
    const email = s.toLowerCase();
    return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
  }
  // a phone number: only digits and the usual punctuation
  if (!/^\+?[\d\s().\- ]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Does this text look like a phone number or email (rather than a name)? */
export function looksLikeHandle(s: string): boolean {
  return handleKey(s) !== null;
}

/** One Messages conversation, as the resolver needs it. */
export interface ChatRow {
  rowid: number;
  guid: string;
  ident: string;
  displayName: string;
  /** 43 group, 45 one-to-one */
  style: number;
  service: string;
  handles: string[];
}

export const isGroup = (c: ChatRow) => c.style === 43 || c.handles.length > 1;

export type Resolved = { ok: true; chats: ChatRow[] } | { ok: false; error: string };

/** A person in Contacts, as the name lookups need it. */
export interface ContactLite {
  name: string;
  phones: string[];
  emails: string[];
}

/** handle key → contact name */
export function nameIndex(contacts: ContactLite[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of contacts) {
    if (!c.name) continue;
    for (const h of [...c.phones, ...c.emails]) {
      const k = handleKey(h);
      if (k && !map.has(k)) map.set(k, c.name);
    }
  }
  return map;
}

/** The one-to-one chats with this handle key (a person often has an iMessage and an SMS chat). */
function directChatsWith(key: string, chats: ChatRow[]): ChatRow[] {
  return chats.filter((c) => !isGroup(c) && c.handles.some((h) => handleKey(h) === key));
}

/**
 * Which conversation(s) `messages_read`'s `chat` means: a chat id, a phone number or email, a
 * contact's name, or a group's name. A one-to-one chat brings its twins on other services along.
 */
export function resolveChat(query: string, chats: ChatRow[], contacts: ContactLite[]): Resolved {
  const q = query.trim();
  const byId = chats.find((c) => c.guid === q) ?? chats.find((c) => c.ident === q && isGroup(c));
  if (byId) {
    if (isGroup(byId)) return { ok: true, chats: [byId] };
    const key = byId.handles[0] ? handleKey(byId.handles[0]) : null;
    const twins = key ? directChatsWith(key, chats) : [];
    return { ok: true, chats: twins.some((c) => c.rowid === byId.rowid) ? twins : [byId, ...twins] };
  }
  const key = handleKey(q);
  if (key) {
    const direct = directChatsWith(key, chats);
    if (direct.length) return { ok: true, chats: direct };
    const groups = chats.filter((c) => c.handles.some((h) => handleKey(h) === key));
    if (groups.length) return { ok: true, chats: groups.slice(0, 1) };
    return { ok: false, error: `There are no texts with ${q} on this Mac.` };
  }
  // a name: Contacts first (exact, then starts with, then contains), then group names
  const lower = q.toLowerCase();
  const tiers = [(n: string) => n === lower, (n: string) => n.startsWith(lower) || n.split(/\s+/).some((w) => w === lower), (n: string) => n.includes(lower)];
  for (const match of tiers) {
    const people = contacts.filter((c) => c.name && match(c.name.toLowerCase()));
    const withChats = people
      .map((p) => ({ p, chats: dedupe([...p.phones, ...p.emails].flatMap((h) => { const k = handleKey(h); return k ? directChatsWith(k, chats) : []; })) }))
      .filter((x) => x.chats.length);
    const names = [...new Set(withChats.map((x) => x.p.name))];
    if (names.length > 1) return { ok: false, error: `More than one person matches “${q}”: ${names.slice(0, 5).join(", ")}. Say which one, or give their number.` };
    if (withChats.length) return { ok: true, chats: dedupe(withChats.flatMap((x) => x.chats)) };
    const groups = chats.filter((c) => isGroup(c) && c.displayName && match(c.displayName.toLowerCase()));
    if (groups.length > 1) return { ok: false, error: `More than one group chat matches “${q}”: ${groups.slice(0, 5).map((g) => g.displayName).join(", ")}. Say which one.` };
    if (groups.length) return { ok: true, chats: groups };
  }
  return { ok: false, error: contacts.length ? `No conversation matches “${q}”. Try their phone number or email.` : `No conversation matches “${q}”. Wisp can't look up names until Contacts is allowed, so try their phone number or email.` };
}

function dedupe(chats: ChatRow[]): ChatRow[] {
  const seen = new Set<number>();
  return chats.filter((c) => (seen.has(c.rowid) ? false : (seen.add(c.rowid), true)));
}

/** A chat's name: its group name, the contact's name, or the handle(s). */
export function chatName(c: ChatRow, names: Map<string, string>): string {
  if (c.displayName) return c.displayName;
  const who = c.handles.map((h) => nameOf(h, names));
  if (who.length === 0) return c.ident;
  if (who.length <= 3) return who.join(", ");
  return `${who.slice(0, 3).join(", ")} and ${who.length - 3} more`;
}

export function nameOf(handle: string, names: Map<string, string>): string {
  const k = handleKey(handle);
  return (k && names.get(k)) || handle;
}

/** Contacts that match a name, company, phone number or email (numbers and emails compared normalized). */
export function searchContacts(contacts: AppleContact[], query: string, limit: number): AppleContact[] {
  const q = query.trim();
  const key = handleKey(q);
  if (key) {
    const hits = contacts.filter((c) => [...c.phones, ...c.emails].some((h) => handleKey(h) === key));
    // a partial number ("555 12"): digits contained in theirs
    if (hits.length || q.includes("@")) return hits.slice(0, limit);
    const digits = q.replace(/\D/g, "");
    return contacts.filter((c) => c.phones.some((p) => p.replace(/\D/g, "").includes(digits))).slice(0, limit);
  }
  const lower = q.toLowerCase();
  const score = (c: AppleContact) => {
    const n = c.name.toLowerCase();
    if (n === lower) return 0;
    if (n.startsWith(lower)) return 1;
    if (n.split(/\s+/).some((w) => w.startsWith(lower))) return 2;
    if (n.includes(lower)) return 3;
    if (c.organization?.toLowerCase().includes(lower)) return 4;
    if (c.emails.some((e) => e.toLowerCase().includes(lower))) return 5;
    return -1;
  };
  return contacts
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((x) => x.c);
}

/** Messages text without the object-replacement marks attachments leave, capped. */
export function cleanText(text: string | null | undefined, hasAttachment: boolean, max = 4000): string {
  let t = (text ?? "").replace(/￼/g, "").trim();
  if (!t) return hasAttachment ? "[attachment]" : "";
  if (t.length > max) t = `${t.slice(0, max)}…`;
  return t;
}

// --- permissions -----------------------------------------------------------------------------

/** CNContactStore authorizationStatus → our words (4 = limited, still readable). */
export function contactsPermission(code: number): ApplePermission {
  return code === 0 ? "not_asked" : code === 3 || code === 4 ? "allowed" : code === 1 || code === 2 ? "denied" : "unknown";
}

/** EKEventStore authorizationStatus → our words (4 = add-only, which can't read). */
export function eventKitPermission(code: number): ApplePermission {
  return code === 0 ? "not_asked" : code === 3 ? "allowed" : code === 1 || code === 2 || code === 4 ? "denied" : "unknown";
}

/** AEDeterminePermissionToAutomateTarget → our words; null when it can't tell (Messages isn't open). */
export function automationPermission(code: number): ApplePermission | null {
  if (code === 0) return "allowed";
  if (code === -1743) return "denied";
  if (code === -1744) return "not_asked";
  return null;
}

/**
 * Who macOS shows in System Settings → Privacy & Security for what `wisp node` does. Permissions go
 * to the "responsible" app: the app bundle the node runs from (the Wisp app, or its own binary as a
 * launchd service), else the terminal it was started in, else the bare `node` binary of a service.
 */
export function permissionHolder(
  execPath = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
  readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf8"),
  appAncestor: () => string | null = () => appOfParents(readFile),
): string {
  const own = appName(execPath, readFile);
  if (own) return own;
  // macOS credits the app that started us (Wisp, Terminal, an editor), the outermost .app up the process chain
  const app = appAncestor();
  if (app) return app;
  const service = env.XPC_SERVICE_NAME;
  const underLaunchd = !!service && service !== "0" && !service.startsWith("application.");
  if (!underLaunchd) {
    const term = env.__CFBundleIdentifier ?? env.TERM_PROGRAM;
    const known: Record<string, string> = { Apple_Terminal: "Terminal", "com.apple.Terminal": "Terminal", "iTerm.app": "iTerm", "com.googlecode.iterm2": "iTerm", vscode: "Visual Studio Code", "com.microsoft.VSCode": "Visual Studio Code", WarpTerminal: "Warp", "dev.warp.Warp-Stable": "Warp", ghostty: "Ghostty", "com.mitchellh.ghostty": "Ghostty" };
    if (term && known[term]) return known[term];
    if (term) return "the app you started Wisp from";
  }
  // a bare binary (a launchd service run by Node.js): System Settings lists it by name; its path helps find it with "+"
  return `${path.basename(execPath)} (${execPath})`;
}

/** The display name of the outermost .app a path sits in ("/Applications/Claude.app/…/node" → "Claude"). */
export function appName(file: string, readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf8")): string | null {
  const bundle = file.match(/^(.*?\/([^/]+)\.app)\//);
  if (!bundle) return null;
  try {
    const plist = readFile(path.join(bundle[1], "Contents", "Info.plist"));
    const name = plist.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? plist.match(/<key>CFBundleName<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    if (name) return name;
  } catch {}
  return bundle[2];
}

/** Walk up the parent processes to the topmost one inside an .app, the one macOS credits (launchd, pid 1, ends it). */
function appOfParents(readFile: (p: string) => string): string | null {
  let pid = process.ppid;
  let found: string | null = null;
  for (let i = 0; i < 30 && pid > 1; i++) {
    let line: string;
    try {
      line = execFileSync("/bin/ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 }).trim();
    } catch {
      break;
    }
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (!m) break;
    found = appName(m[2], readFile) ?? found;
    pid = Number(m[1]);
  }
  return found;
}
