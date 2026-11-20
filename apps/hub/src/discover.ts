import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { looksSecret, parseMemoryAnswer } from "@wisp/core/src/memory-import.ts";

/**
 * Onboarding v3, page 3, "Look around this Mac": with the person's one yes, the hub reads a few
 * things on the computer it runs on (only when that's a Mac or Windows PC, i.e. theirs, not a Cloud
 * server) and turns them into short facts. Nothing is saved here; the person sees every fact as a
 * chip, removes what they like, and the page saves the rest.
 */

export type DiscoverPart = "git" | "harnesses" | "notes" | "projects";
export const DISCOVER_PARTS: DiscoverPart[] = ["git", "harnesses", "notes", "projects"];

/** You / Work / Tools / Likes, saved under these note titles. */
export type FactGroup = "You" | "Work" | "Tools" | "Likes";

export interface Fact {
  group: FactGroup;
  text: string;
  /** where it came from, shown on the chip: "git", "CLAUDE.md", "projects", "signed in" */
  src: string;
}

export interface DiscoverResult {
  /** what was found, for the line's right side: "Sam Lee", "2 files" */
  found: string;
  facts: Fact[];
}

/** Each part gives up after this long; the page never waits on a slow disk or git. */
export const PART_TIMEOUT_MS = 4000;

/** Whether the hub runs on a person's own computer (macOS or Windows), not a Linux server. */
export function discoverAvailable(platform = process.platform): boolean {
  if (process.env.WISP_DISCOVER === "0") return false;
  return platform === "darwin" || platform === "win32" || process.env.WISP_DISCOVER === "1";
}

export const computerLabel = (platform = process.platform) => (platform === "darwin" ? "this Mac" : "this computer");

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => {
    execFile(cmd, args, { timeout: PART_TIMEOUT_MS, windowsHide: true }, (err, out) => resolve(err ? "" : String(out).trim()));
  });

const withTimeout = <T>(p: Promise<T>, fallback: T): Promise<T> => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), PART_TIMEOUT_MS).unref())]);

const clean = (t: string) => t.replace(/\s+/g, " ").trim();

async function gitPart(): Promise<DiscoverResult> {
  const [name, email] = await Promise.all([run("git", ["config", "--global", "user.name"]), run("git", ["config", "--global", "user.email"])]);
  const facts: Fact[] = [];
  const n = clean(name).slice(0, 80);
  const e = clean(email).slice(0, 120);
  if (n && !looksSecret(n)) facts.push({ group: "You", text: `You're ${n}`, src: "git" });
  if (e && /^[^@\s]+@[^@\s]+$/.test(e) && !e.endsWith("users.noreply.github.com")) facts.push({ group: "You", text: `Email: ${e}`, src: "git" });
  return { found: n || (e ? e : "Nothing set"), facts };
}

/** The global instruction files people keep for their AI tools. */
export const NOTE_FILES: { file: string; label: string }[] = [
  { file: ".claude/CLAUDE.md", label: "CLAUDE.md" },
  { file: ".codex/AGENTS.md", label: "AGENTS.md" },
  { file: ".gemini/GEMINI.md", label: "GEMINI.md" },
];

/** Most facts kept from one instruction file. */
const NOTE_FACTS = 8;

/**
 * Short rules from an instruction file: its bullet lines, through the memory-import filter (no
 * passwords, keys, card or bank numbers), without code, links to files or long paragraphs.
 */
export function factsFromNotes(text: string, label: string): Fact[] {
  const bullets = text
    .split(/\r?\n/)
    .filter((l) => /^\s{0,3}(?:[-*•]|\d+[.)])\s+\S/.test(l))
    .join("\n");
  const out: Fact[] = [];
  for (const l of parseMemoryAnswer(bullets).lines) {
    const t = l.text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
    if (t.length < 8 || t.length > 140) continue;
    if (/[{}<>$]|https?:\/\/|\/Users\/|~\/|\\\\/.test(t)) continue;
    // links to other notes and names of other people's email addresses stay out
    if (/\[\[|@\w+\.\w+/.test(t)) continue;
    out.push({ group: "Likes", text: t.replace(/\.$/, ""), src: label });
    if (out.length >= NOTE_FACTS) break;
  }
  return out;
}

async function notesPart(home: string): Promise<DiscoverResult> {
  const facts: Fact[] = [];
  let files = 0;
  for (const n of NOTE_FILES) {
    const text = await fs.readFile(path.join(home, n.file), "utf8").catch(() => null);
    if (text == null) continue;
    files++;
    facts.push(...factsFromNotes(text.slice(0, 60_000), n.label));
  }
  return { found: files ? `${files} ${files === 1 ? "file" : "files"}` : "None found", facts };
}

/**
 * Claude Code keeps a folder per project it opened, named after the project's path with the
 * slashes as dashes ("-Users-sam-shop-web"). The last part is a good enough name; worktrees and
 * temp folders are skipped.
 */
export function projectNameFromDir(dir: string): string | null {
  if (/--claude-worktrees-|^-(private|tmp|var)-/.test(dir)) return null;
  const parts = dir.split("-").filter(Boolean);
  const last = parts.at(-1);
  if (!last || parts.length < 3) return null;
  // temp and scratch folders are named with ids, not words
  if (/^[0-9a-f]{5,}$/i.test(last) || /^\d+$/.test(last) || /^(tmp|temp|scratchpad|worktree)$/i.test(last)) return null;
  return last.slice(0, 60);
}

const PROJECTS = 5;

async function projectsPart(home: string): Promise<DiscoverResult> {
  const root = path.join(home, ".claude", "projects");
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const dated = await Promise.all(names.slice(0, 500).map(async (d) => ({ d, at: (await fs.stat(path.join(root, d)).catch(() => null))?.mtimeMs ?? 0 })));
  const monthAgo = Date.now() - 30 * 86_400_000;
  const seen = new Set<string>();
  const facts: Fact[] = [];
  for (const { d } of dated.filter((x) => x.at >= monthAgo).sort((a, b) => b.at - a.at)) {
    const name = projectNameFromDir(d);
    if (!name || seen.has(name.toLowerCase()) || looksSecret(name)) continue;
    seen.add(name.toLowerCase());
    facts.push({ group: "Work", text: name, src: "projects" });
    if (facts.length >= PROJECTS) break;
  }
  return { found: facts.length ? `${facts.length} ${facts.length === 1 ? "project" : "projects"}` : "None lately", facts };
}

/** One part, never throwing and never slower than PART_TIMEOUT_MS. Harnesses come from the hub (see api-onboarding.ts). */
export function discoverPart(part: Exclude<DiscoverPart, "harnesses">, home = os.homedir()): Promise<DiscoverResult> {
  const none: DiscoverResult = { found: "Couldn't look", facts: [] };
  const p = part === "git" ? gitPart() : part === "notes" ? notesPart(home) : projectsPart(home);
  return withTimeout(p, none);
}
