import { create } from "zustand";
import { memoryPrompt, parseMemoryAnswer } from "@wisp/core/src/memory-import.ts";
import { api } from "./api.ts";
import { FACT_GROUPS, NOTE_OF_GROUP, SCAN_PARTS, factsFromAnswer, loadAnswers, saveAnswers, type Fact, type ScanPart } from "./onboardingV3.ts";

/**
 * Onboarding v3, page 3, in the background: "Look around this Mac" and the memory import keep
 * running after the person leaves the page. Findings land here (so every later page can show them
 * and the "Still learning…" line), in this browser's saved answers, and in the person's memory notes
 * "About me", "Projects", "Tools and accounts" and "Preferences and rules" as they arrive.
 */

export type PartState = { state: "idle" | "busy" | "done"; found: string };
export type ImportApp = "chatgpt" | "claude" | "grok" | "other";
export const IMPORT_APPS: { id: ImportApp; label: string }[] = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "grok", label: "Grok" },
  { id: "other", label: "Other" },
];
const appLabel = (a: ImportApp) => IMPORT_APPS.find((x) => x.id === a)!.label;

interface KnowState {
  workspaceId: string | null;
  /** whether the hub can look around (null: not asked yet) */
  available: boolean | null;
  computer: string;
  scan: "idle" | "running" | "done";
  parts: Record<ScanPart, PartState>;
  facts: Fact[];
  /** the newest finding, for "Still learning…" */
  latest: string | null;
  /** git found the person's name (the ghost hops) */
  nameFound: number;
  app: ImportApp;
  /** waiting on the one-time link for the other AI's answer */
  listening: boolean;
  imported: { app: string; kept: number } | null;
}

const idleParts = (): Record<ScanPart, PartState> => Object.fromEntries(SCAN_PARTS.map((p) => [p.id, { state: "idle", found: "" }])) as Record<ScanPart, PartState>;

export const useKnow = create<KnowState>(() => ({
  workspaceId: null,
  available: null,
  computer: "this Mac",
  scan: "idle",
  parts: idleParts(),
  facts: [],
  latest: null,
  nameFound: 0,
  app: "chatgpt",
  listening: false,
  imported: null,
}));

/** Whether anything is still running in the background. */
export const stillLearning = (s: KnowState) => s.scan === "running" || s.listening;

let seq = 0;
const factId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Start (or resume) for this workspace: the facts saved earlier, and whether looking around is possible. */
export function initKnow(workspaceId: string) {
  const s = useKnow.getState();
  if (s.workspaceId !== workspaceId) useKnow.setState({ workspaceId, facts: loadAnswers(workspaceId).facts ?? [], parts: idleParts(), scan: "idle", imported: null, latest: null });
  if (useKnow.getState().available === null)
    api<{ available: boolean; label: string }>("GET", "/api/onboarding/discover").then(
      (r) => useKnow.setState({ available: r.available, computer: r.label }),
      () => useKnow.setState({ available: false }),
    );
}

/** Add findings (deduped by group and text), remember them, and save them to the notes. */
export function addFacts(found: Omit<Fact, "id">[]) {
  if (!found.length) return;
  const s = useKnow.getState();
  // removed chips stay removed when a later look finds them again
  const have = new Set([...s.facts.map((f) => `${f.group}\n${f.text.toLowerCase()}`), ...dropped]);
  const fresh = found.filter((f) => !have.has(`${f.group}\n${f.text.toLowerCase()}`)).map((f) => ({ ...f, id: factId() }));
  if (!fresh.length) return;
  useKnow.setState({ facts: [...s.facts, ...fresh], latest: fresh.at(-1)!.text });
  persist();
}

const dropped = new Set<string>();

export function dropFact(id: string) {
  const f = useKnow.getState().facts.find((x) => x.id === id);
  if (f) dropped.add(`${f.group}\n${f.text.toLowerCase()}`);
  useKnow.setState((s) => ({ facts: s.facts.filter((f) => f.id !== id) }));
  persist();
}

function persist() {
  const { workspaceId, facts } = useKnow.getState();
  if (!workspaceId) return;
  saveAnswers(workspaceId, { facts });
  scheduleNotes();
}

/** Look around the computer, one part after another, each ticking as it comes back. */
export async function startScan() {
  if (useKnow.getState().scan === "running") return;
  useKnow.setState({ scan: "running", parts: idleParts() });
  for (const p of SCAN_PARTS) {
    useKnow.setState((s) => ({ parts: { ...s.parts, [p.id]: { state: "busy", found: "" } } }));
    const r = await api<{ found: string; facts: Omit<Fact, "id">[] }>("POST", `/api/onboarding/discover/${p.id}`).catch(() => ({ found: "Couldn't look", facts: [] }));
    useKnow.setState((s) => ({ parts: { ...s.parts, [p.id]: { state: "done", found: r.found } }, ...(p.id === "git" && r.facts.some((f) => f.text.startsWith("You're ")) ? { nameFound: s.nameFound + 1 } : {}) }));
    addFacts(r.facts);
  }
  useKnow.setState({ scan: "done" });
}

export const pickApp = (app: ImportApp) => useKnow.setState({ app });

let link: { id: string; url: string } | null = null;
let poll: ReturnType<typeof setInterval> | undefined;

/** Copy the memory-import question (with a one-time link the other AI can post its answer to), and listen on that link. */
export async function copyQuestion(): Promise<boolean> {
  link ??= await api<{ id: string; url: string }>("POST", "/api/memory-links").catch(() => null);
  let ok = true;
  try {
    await navigator.clipboard.writeText(memoryPrompt(link?.url));
  } catch {
    ok = false;
  }
  if (link && !poll) {
    useKnow.setState({ listening: true });
    const id = link.id;
    poll = setInterval(async () => {
      const r = await api<{ answer: string | null; expired: boolean }>("GET", `/api/memory-links/${id}`).catch(() => null);
      if (r?.answer) takeAnswer(r.answer);
      if (r?.answer || r?.expired) stopListening();
    }, 3000);
  }
  return ok;
}

export const questionText = () => memoryPrompt(link?.url);

function stopListening() {
  clearInterval(poll);
  poll = undefined;
  link = null;
  useKnow.setState({ listening: false });
}

/** The other AI's answer: keep the useful lines (secrets and other people left out). Returns how many were kept. */
export function takeAnswer(answer: string): number {
  const s = useKnow.getState();
  const src = s.app === "other" ? "pasted" : appLabel(s.app);
  const facts = factsFromAnswer(parseMemoryAnswer(answer).lines, src);
  addFacts(facts);
  // the answer is in: stop waiting on the link
  if (facts.length) stopListening();
  useKnow.setState({ imported: { app: s.app === "other" ? "your AI" : appLabel(s.app), kept: facts.length } });
  return facts.length;
}

// --- saving to memory notes ---------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;
let writing: Promise<void> = Promise.resolve();
/** note path by title, once known */
const paths = new Map<string, string>();

function scheduleNotes() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    writing = writing.then(writeNotes, writeNotes);
  }, 800);
}

/** Write now (Continue): waits for the last write too. */
export async function flushNotes() {
  clearTimeout(timer);
  writing = writing.then(writeNotes, writeNotes);
  await writing;
}

/**
 * One note per group in the person's memory (what every agent reads before it works): details for
 * About me, Projects and Tools and accounts, a preference for Preferences and rules. Rewritten
 * whole from the kept facts, so a removed chip leaves the note too.
 */
async function writeNotes() {
  const facts = useKnow.getState().facts;
  if (!paths.size) {
    const p = await api<{ items: { path: string; title: string }[] }>("GET", "/api/memory/profile?user=me").catch(() => null);
    for (const i of p?.items ?? []) if (Object.values(NOTE_OF_GROUP).includes(i.title)) paths.set(i.title, i.path);
  }
  for (const g of FACT_GROUPS) {
    const title = NOTE_OF_GROUP[g];
    const lines = facts.filter((f) => f.group === g).map((f) => `- ${f.text} (${f.src})`);
    const old = paths.get(title);
    if (!lines.length) {
      if (old) await api("DELETE", `/api/vault/note?path=${encodeURIComponent(old)}`).then(() => paths.delete(title), () => {});
      continue;
    }
    const text = lines.join("\n").slice(0, 3900);
    const r = await api<{ saved: boolean; path?: string }>("POST", "/api/memory/remember", {
      about: "me",
      kind: g === "Likes" ? "preference" : "detail",
      title,
      text,
      pinned: true,
      force: true,
      ...(old ? { replaces: old } : {}),
    }).catch(() => null);
    if (r?.path) paths.set(title, r.path);
  }
}

/** For tests. */
export function resetKnow() {
  stopListening();
  clearTimeout(timer);
  paths.clear();
  dropped.clear();
  useKnow.setState({ workspaceId: null, available: null, scan: "idle", parts: idleParts(), facts: [], latest: null, nameFound: 0, imported: null });
}
