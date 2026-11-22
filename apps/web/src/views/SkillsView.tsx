import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Download, ExternalLink, FileText, Laptop, Link2, MoreHorizontal, Plus, Share2, Users, Wand2, X } from "lucide-react";
import { catalogSkill, skillFile, type Agent, type CatalogSkill, type Skill, type StoreSkill } from "@wisp/core";
import { api } from "../api.ts";
import { renderMarkdown } from "../markdown.ts";
import { MoreOptions } from "../components/MoreOptions.tsx";
import { openDm } from "../openDm.ts";
import { readSkillFile, readSkillLink, skillLink, type SharedSkill } from "../skillShare.ts";
import { Button, Loader, Menu } from "../components/ui.tsx";
import { AreaBox, Chip, Dlg, FactRow, Item, Label, Labeled, ItemHead, Panel, Prim, RemoveBtn, Rows, Sec, Seg, TextBox, Tile } from "../components/MarketParts.tsx";
import { AgentPicker, CatalogIcon, WhoCanUse } from "../components/ShopParts.tsx";

export const SOURCE: Record<Skill["source"], string> = { catalog: "From the library", custom: "Made here", taught: "Taught", learned: "Learned" };

const NEW_SKILL = `# <What this skill does>

## When to use it
- …

## Steps
1. …
2. …

## Rules
- …
`;

/** First sentence of a skill description as a plain "what it's for" line, cut at a word boundary. */
export function whatItsFor(description: string, max = 110): string {
  const flat = description.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const text = flat.replace(/^Use (when|for) /i, (m) => (/for/i.test(m) ? "For " : "When "));
  const first = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).replace(/[\s,;:.-]+$/, "")}…`;
}

/** "Everyday Helper has this" / "No helper has this yet", from the helpers that hold a skill. */
export function helperLine(agents: Pick<Agent, "id" | "name">[], ids: string[]): string {
  const names = ids.map((id) => agents.find((a) => a.id === id)?.name).filter((n): n is string => !!n);
  if (names.length === 0) return "No agent has this yet";
  if (names.length === 1) return `${names[0]} has this`;
  if (names.length === 2) return `${names[0]} and ${names[1]} have this`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more have this`;
}

/** A sentence to paste into chat to try a skill. Skills carry no example, so it is built from the name and what it's for. */
export function trySuggestion(skill: { name: string; description: string }): string {
  const purpose = whatItsFor(skill.description);
  return `Please use your "${skill.name.trim()}" skill for this.${purpose ? ` (It is for this: ${lowerFirst(purpose)})` : ""} Here is what I have: `;
}

/** Lowercase a leading capital so the text can follow a lead-in, but keep "I", "I'm" and acronyms. */
const lowerFirst = (v: string) => (/^[A-Z][a-z]/.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : v);

const oneLine = (v: string) => v.replace(/\s+/g, " ").trim();

/**
 * The guided "Create a skill" answers turned into what the save API wants: a "Use when…" description
 * and a Markdown body. Empty sections are left out; the name becomes the heading. Newlines in the
 * description are flattened (it is one line in the SKILL.md front matter, where skillFile quotes it).
 */
export function skillFromGuide(g: { name: string; what: string; when: string; result: string }): { description: string; content: string } {
  const name = oneLine(g.name);
  const when = g.when.trim();
  const sections: [string, string][] = [
    ["What to do", g.what.trim()],
    ["When to use it", when],
    ["What a good result looks like", g.result.trim()],
  ];
  const body = sections.filter(([, t]) => t).map(([h, t]) => `## ${h}\n${t}`);
  const lead = oneLine(when);
  const description = !lead ? "" : /^use (when|for)\b/i.test(lead) ? lead : `Use when ${lowerFirst(lead)}`;
  return { description: description.slice(0, 500), content: [`# ${name || "New skill"}`, ...body].join("\n\n") + "\n" };
}

/**
 * The plain-words version of a skill for Simple mode. A library entry (skill null) or an installed,
 * unedited catalog skill uses the catalog's `plain` text; an edited or custom skill only gets a
 * line made from its own description, since the catalog text no longer describes it.
 */
export function plainSkill(skill: Pick<Skill, "description" | "content" | "catalogId"> | null, entry: CatalogSkill | undefined): { does: string; needs: string | null; example: string | null } {
  const description = skill?.description ?? entry?.description ?? "";
  const same = !skill || (!!skill.catalogId && !!entry && skill.content === entry.content);
  const plain = same ? entry?.plain : undefined;
  return { does: plain?.does ?? whatItsFor(description), needs: plain?.needs ?? null, example: plain?.example ?? null };
}

/** What the detail panel shows: an installed skill, or a shop item not installed yet. */
export type Open = { skill: Skill } | { entry: CatalogSkill };

const HARNESS_NAMES: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", hermes: "Hermes" };
const STORE_NAMES: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };

/** Where an installed skill came from, in a few words. */
export function skillOrigin(s: Pick<Skill, "source" | "catalogId">): string {
  const id = s.catalogId ?? "";
  if (id.startsWith("device:")) return `From ${HARNESS_NAMES[id.split(":")[2]] ?? "a device"}`;
  const store = /^([a-z]+):/.exec(id)?.[1];
  if (s.source === "catalog" && store && STORE_NAMES[store]) return `From ${STORE_NAMES[store]}`;
  return SOURCE[s.source];
}

/** A harness's own skill or command, as GET /api/skills/built-in lists it. */
export interface BuiltInSkill {
  name: string;
  description?: string;
  harness: string;
  harnessLabel: string;
  agentIds: string[];
}

/** The id a built-in skill's page goes by (#/settings/skills/<id>). */
export const builtInId = (b: Pick<BuiltInSkill, "harness" | "name">) => `built-in:${b.harness}:${b.name}`;

/** "Oct 29". */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const agentName = (agents: Pick<Agent, "id" | "name">[], id: string | null | undefined) => (id ? agents.find((a) => a.id === id)?.name : undefined);

/** Who has a skill, in a word or two: "All agents", "Nova", "3 agents", "No agents". */
export function skillHolders(s: Pick<Skill, "allAgents" | "agentIds">, agents: Pick<Agent, "id" | "name">[]): string {
  if (s.allAgents) return "All agents";
  const names = s.agentIds.map((id) => agentName(agents, id)).filter((n): n is string => !!n);
  return names.length === 0 ? "No agents" : names.length === 1 ? names[0] : `${names.length} agents`;
}

/** Where a skill came from, for its row: "Ghosty · Oct 29", "Anthropic", "Imported from your Mac", "Made here". */
export function skillByline(s: Pick<Skill, "source" | "catalogId" | "learnedBy" | "createdAt">, agents: Pick<Agent, "id" | "name">[], deviceName?: (nodeId: string) => string | undefined): string {
  if (s.source === "learned") return `${agentName(agents, s.learnedBy) ?? "An agent"} · ${shortDate(s.createdAt)}`;
  const id = s.catalogId ?? "";
  if (id.startsWith("device:")) return `Imported from ${deviceName?.(id.split(":")[1]) ?? "a device"}`;
  const store = /^([a-z]+):/.exec(id)?.[1];
  if (s.source === "catalog") return (store && STORE_NAMES[store]) || "Wisp";
  return SOURCE[s.source];
}

/** The line under a skill's name on its page: "Learned by Ghosty · Oct 29 · used 3 times". */
export function skillMeta(s: Pick<Skill, "source" | "catalogId" | "learnedBy" | "createdAt" | "updatedAt" | "uses">, agents: Pick<Agent, "id" | "name">[]): string {
  const uses = s.uses ?? 0;
  const used = uses ? `used ${uses === 1 ? "once" : `${uses} times`}` : null;
  const head = s.source === "learned" ? `Learned by ${agentName(agents, s.learnedBy) ?? "an agent"} · ${shortDate(s.createdAt)}` : `${skillOrigin(s)} · updated ${shortDate(s.updatedAt)}`;
  return [head, used].filter(Boolean).join(" · ");
}

/** "Who can use it": just the agent that learned it, some agents, or all of them. */
type Who = "just" | "some" | "all";

/** The skill's access as the page's segmented control shows it. A learned skill whose agent is gone falls back to "some". */
export function whoValue(s: Pick<Skill, "source" | "allAgents" | "learnedBy">, agents: Pick<Agent, "id">[]): Who {
  if (s.allAgents) return "all";
  return s.source === "learned" && s.learnedBy && agents.some((a) => a.id === s.learnedBy) ? "just" : "some";
}

/** What to send when "Who can use it" changes. "Just" the agent that learned it only while that agent is still around. */
export function whoPatch(s: Pick<Skill, "learnedBy">, to: Who, agents: Pick<Agent, "id">[]): { allAgents: boolean; agentIds?: string[] } {
  if (to === "all") return { allAgents: true };
  if (to === "just" && s.learnedBy && agents.some((a) => a.id === s.learnedBy)) return { allAgents: false, agentIds: [s.learnedBy] };
  return { allAgents: false };
}

/** The one muted line under an added skill's name: what it is, where it came from, how often it's used. */
export function skillLine(s: Pick<Skill, "source" | "catalogId" | "learnedBy" | "uses">, agents: Pick<Agent, "id" | "name">[]): string {
  const uses = s.uses ?? 0;
  const from = s.source === "learned" ? `learned by ${agentName(agents, s.learnedBy) ?? "an agent"}` : lowerFirst(skillOrigin(s));
  return ["Skill", from, uses ? `used ${uses === 1 ? "once" : `${uses} times`}` : null].filter(Boolean).join(" · ");
}

/** A skill's instructions, unfolded under its card. */
function Instructions({ text, html, loading }: { text?: string; html: string; loading?: boolean }) {
  return (
    <div className="space-y-3 rounded-[14px] bg-card px-4 py-3.5">
      {text && <p className="text-sm font-medium">{text}</p>}
      {loading ? <Loader /> : html && <div className="prose-w text-sm text-ink/90" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

/**
 * An added or learned skill's page: its name and one line; a card of rows (who can use it, what
 * it does, More); Edit and Share behind the dots; Remove set apart at the bottom.
 */
function SkillPage({ skill, agents, canEdit, icon, onEdit, onChanged, onGone, onShare }: { skill: Skill; agents: Agent[]; canEdit: boolean; icon?: ReactNode; onEdit: (s: Skill) => void; onChanged: (id?: string) => void; onGone: () => void; onShare: (s: Skill) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState(false);
  const [does, setDoes] = useState(false);
  const [more, setMore] = useState(false);
  // the instructions are drawn only once they are unfolded
  const html = useMemo(() => (does ? renderMarkdown(skill.content) : ""), [does, skill.content]);

  async function run(p: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await p();
      onChanged(skill.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // the picker hands back the whole list; send only what changed
  const pick = (ids: string[]) =>
    run(async () => {
      for (const id of ids) if (!skill.agentIds.includes(id)) await api("PUT", `/api/skills/${skill.id}/agents/${id}`);
      for (const id of skill.agentIds) if (!ids.includes(id)) await api("DELETE", `/api/skills/${skill.id}/agents/${id}`);
    });

  async function forget() {
    if (!confirm(`Remove "${skill.name}"? Agents that use it lose it.`)) return;
    try {
      await api("DELETE", `/api/skills/${skill.id}`);
      onGone();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="m-work space-y-4">
      <ItemHead tile={<Tile size={56}>{icon ?? <CatalogIcon name={catalogSkill(skill.catalogId ?? "")?.icon} fallback={Wand2} size={26} />}</Tile>} name={skill.name} line={skillLine(skill, agents)}>
        {canEdit && (
          <Menu
            align="right"
            items={[
              { label: "Edit", onSelect: () => onEdit(skill) },
              { label: "Share", onSelect: () => onShare(skill) },
            ]}
            trigger={(open, toggle) => (
              <button type="button" className="circle circle-sm" aria-label={`More for ${skill.name}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                <MoreHorizontal size={16} aria-hidden />
              </button>
            )}
          />
        )}
      </ItemHead>
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}

      <Rows>
        <FactRow label="Who can use it" value={skillHolders(skill, agents)} onClick={canEdit ? () => setWho(true) : undefined} />
        <FactRow label="Does" value={whatItsFor(skill.description, 70)} onClick={() => setDoes(!does)} open={does} />
        <FactRow label="More" onClick={() => setMore(!more)} open={more} />
      </Rows>
      {does && <Instructions text={skill.description} html={html} />}
      {more && (
        <div className="space-y-1 px-1 text-[13px] leading-5 text-muted">
          <p>{skillMeta(skill, agents)}</p>
          <p>
            File: <span className="font-mono">me/skills/{skill.slug}/SKILL.md</span>
          </p>
          {skill.tags.length > 0 && <p>Tags: {skill.tags.join(", ")}</p>}
        </div>
      )}

      {canEdit && (
        <div className="pt-3">
          <RemoveBtn onClick={() => void forget()}>Remove</RemoveBtn>
        </div>
      )}
      {who && (
        <WhoCanUse
          agents={agents}
          allAgents={!!skill.allAgents}
          agentIds={skill.agentIds}
          disabled={!canEdit || busy}
          error={error}
          onAll={(on) => void run(() => api("PATCH", `/api/skills/${skill.id}`, { allAgents: on }))}
          onPick={(ids) => void pick(ids)}
          onClose={() => setWho(false)}
        />
      )}
    </div>
  );
}

/** A harness's own skill or command: read only, it comes with the harness. */
export function BuiltInSkillPage({ skill, agents }: { skill: BuiltInSkill; agents: Agent[] }) {
  const names = skill.agentIds.map((id) => agents.find((a) => a.id === id)?.name).filter((n): n is string => !!n);
  return (
    <div className="m-work space-y-4">
      <ItemHead tile={<Tile size={56}><Wand2 size={26} strokeWidth={1.7} /></Tile>} name={skill.name} line={`Skill · built into ${skill.harnessLabel}`} />
      <Rows>
        <FactRow label="Who can use it" value={names.length ? names.join(", ") : `${skill.harnessLabel} agents`} />
        {skill.description && <FactRow label="Does" value={skill.description} wrap />}
      </Rows>
    </div>
  );
}

/**
 * A skill's page: once it's added, who has it, what it does, Edit, Share and Remove; before that,
 * what it does and needs, its full instructions, and Add.
 */
export function SkillDetail(props: { open: Open; agents: Agent[]; canEdit: boolean; icon?: ReactNode; onInstall: (e: CatalogSkill) => void; onEdit: (s: Skill) => void; onChanged: (id?: string) => void; onGone: () => void; onTry?: (skill: { name: string; description: string; agentIds: string[] }) => void; onShare: (s: Skill) => void }) {
  if ("skill" in props.open) return <SkillPage {...props} skill={props.open.skill} />;
  return <LibrarySkill {...props} entry={props.open.entry} />;
}

/** A library skill not added yet: what it does and needs, its instructions, and Add. */
function LibrarySkill({ entry, canEdit, onInstall }: { entry: CatalogSkill; canEdit: boolean; onInstall: (e: CatalogSkill) => void }) {
  const { name, description, content } = entry;
  const plain = plainSkill(null, entry);
  const [does, setDoes] = useState(false);
  const [more, setMore] = useState(false);
  const html = useMemo(() => (does ? renderMarkdown(content) : ""), [does, content]);

  return (
    <div className="space-y-4">
      <ItemHead tile={<Tile size={56}><CatalogIcon name={entry.icon} fallback={Wand2} size={26} /></Tile>} name={name} line="Skill · by Wisp">
        {canEdit && (
          <Button variant="primary" onClick={() => onInstall(entry)}>
            Add
          </Button>
        )}
      </ItemHead>
      <Rows>
        <FactRow label="Does" value={plain.does || whatItsFor(description, 70)} onClick={() => setDoes(!does)} open={does} />
        {plain.needs && <FactRow label="Needs" value={plain.needs} wrap />}
        <FactRow label="More" onClick={() => setMore(!more)} open={more} />
      </Rows>
      {does && <Instructions text={plain.does || description} html={html} />}
      {more && (
        <div className="space-y-1 px-1 text-[13px] leading-5 text-muted">
          <p>Made by Wisp</p>
          {plain.example && <p>For example: {plain.example}</p>}
        </div>
      )}
    </div>
  );
}

/** A public skill before it's added: who made it, what it does, its instructions; its licence and source under More. */
export function StoreSkillDetail({ s, icon, canEdit, onAdd }: { s: StoreSkill; icon: ReactNode; canEdit: boolean; onAdd: () => void }) {
  const [content, setContent] = useState<string | null | undefined>(undefined);
  const [does, setDoes] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    api<{ content: string | null }>("GET", `/api/skill-store/${encodeURIComponent(s.id)}`).then((r) => setContent(r.content), () => setContent(null));
  }, [s.id]);
  const html = useMemo(() => (does && content ? renderMarkdown(content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")) : ""), [does, content]);
  return (
    <div className="space-y-4">
      <ItemHead tile={<Tile size={56}>{icon}</Tile>} name={s.name} line={`Skill · by ${s.source.label}`}>
        {canEdit && s.license.open && (
          <Button variant="primary" onClick={onAdd}>
            Add
          </Button>
        )}
      </ItemHead>
      {!s.license.open && (
        <p className="px-1 text-[13px] text-muted">
          Its licence doesn't allow copying.{" "}
          <a className="underline hover:text-ink" href={s.url} target="_blank" rel="noreferrer">
            Read it at {s.source.label}
          </a>
        </p>
      )}
      <Rows>
        <FactRow label="Does" value={whatItsFor(s.description, 70)} onClick={() => setDoes(!does)} open={does} />
        <FactRow label="More" onClick={() => setMore(!more)} open={more} />
      </Rows>
      {does && <Instructions text={s.description} html={html} loading={content === undefined} />}
      {more && (
        <div className="space-y-1 px-1 text-[13px] leading-5 text-muted">
          <p>Licence: {s.license.label}</p>
          <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
            Source <ExternalLink size={12} aria-hidden />
          </a>
        </div>
      )}
    </div>
  );
}

/** "Try it": the request to paste into a chat, or to start a chat with a helper that has the skill. */
export function TryDialog({ skill, agents, onClose }: { skill: { name: string; description: string; agentIds: string[] }; agents: Agent[]; onClose: () => void }) {
  const holders = skill.agentIds.map((id) => agents.find((a) => a.id === id)).filter((a): a is Agent => !!a);
  const [pick, setPick] = useState(holders[0]?.id ?? "");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const helper = holders.find((a) => a.id === pick) ?? holders[0];
  const text = trySuggestion(skill);
  const sid = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError(null);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the text and copy it yourself.");
    }
  }
  async function chat() {
    if (!helper) return;
    try {
      await openDm(helper.id, text);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Dlg title="Try it" sub={skill.name} onClose={onClose}>
      <p className="px-1 text-sm text-muted">{helper ? "Start a chat with this request ready. Add your own details, then send." : "Install the skill first so an agent can use it. Meanwhile, this is a request to try."}</p>
      <p className="select-all whitespace-pre-wrap rounded-2xl border border-control-line bg-control px-4 py-3.5 text-base leading-snug" aria-label="Suggested request">
        {text}
      </p>
      {holders.length > 1 && (
        <div className="flex items-center gap-2 px-1">
          <label htmlFor={sid} className="text-sm">
            Which agent?
          </label>
          <select id={sid} value={helper?.id} onChange={(e) => setPick(e.target.value)} className="h-9 rounded-full border border-control-line bg-control px-3 text-sm">
            {holders.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Sec onClick={copy}>{copied ? <><Check size={15} /> Copied</> : "Copy request"}</Sec>
        {helper && <Prim className="h-11 text-body" onClick={chat}>Open chat with {helper.name}</Prim>}
      </div>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
      {error && <p className="text-sm text-bad">{error}</p>}
    </Dlg>
  );
}

/** Tags as chips, with a "+ Add" that turns into a small field. */
function TagsInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const commit = () => {
    const t = text.trim().toLowerCase().replace(/,/g, "");
    if (t && !tags.includes(t) && tags.length < 10) onChange([...tags, t]);
    setText("");
    setAdding(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <span key={t} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control-line bg-control pl-4 pr-2 text-sm">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="grid size-6 place-items-center rounded-full text-muted hover:text-ink">
            <X size={13} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={text}
          aria-label="New tag"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setText("");
              setAdding(false);
            }
          }}
          className="h-9 w-32 rounded-full border border-control-line bg-control px-4 text-sm outline-none"
        />
      ) : (
        <Chip onClick={() => setAdding(true)}>
          <Plus size={14} /> Add
        </Chip>
      )}
    </div>
  );
}

export function SkillEditor({ skill, agents, onClose, onSaved, onShare }: { skill: Skill | null; agents: Agent[]; onClose: () => void; onSaved: (s: Skill) => void; onShare?: (s: Skill) => void }) {
  const guided = !skill;
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [tags, setTags] = useState<string[]>(skill?.tags ?? []);
  const [content, setContent] = useState(skill?.content ?? NEW_SKILL);
  const [what, setWhat] = useState("");
  const [when, setWhen] = useState("");
  const [result, setResult] = useState("");
  // Guided mode: the Markdown comes from the three answers until the person edits it directly;
  // after that their edited text is what gets saved (and "Use the answers again" undoes it).
  const [rawEdit, setRawEdit] = useState<string | null>(null);
  const [agentIds, setAgentIds] = useState<string[]>(skill?.agentIds ?? []);
  const [allAgents, setAllAgents] = useState(skill?.allAgents ?? true);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generated = useMemo(() => skillFromGuide({ name, what, when, result }), [name, what, when, result]);
  const finalContent = guided ? (rawEdit ?? generated.content) : content;
  const finalDescription = guided ? generated.description : description.trim();
  const html = useMemo(() => (preview ? renderMarkdown(finalContent) : ""), [preview, finalContent]);
  const canSave = guided ? !!name.trim() && !!(what.trim() || rawEdit?.trim()) : !!name.trim() && !!content.trim();

  async function save() {
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), description: finalDescription, content: finalContent, tags: tags.slice(0, 10), agentIds, allAgents };
    try {
      onSaved(skill ? await api<Skill>("PATCH", `/api/skills/${skill.id}`, body) : await api<Skill>("POST", "/api/skills", body));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const editor = (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="flex-1 px-1 text-[13px] tracking-wide text-faint">Full instructions</span>
        <Seg
          label="Instructions view"
          value={preview ? "preview" : "write"}
          onChange={(v) => setPreview(v === "preview")}
          options={[
            ["write", "Write"],
            ["preview", "Preview"],
          ]}
        />
      </div>
      {preview ? (
        <div aria-label="Preview of the instructions" className="prose-w max-h-[50vh] min-h-48 overflow-y-auto rounded-2xl border border-control-line bg-control p-4 text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      ) : guided ? (
        <>
          <AreaBox className="min-h-48 font-mono text-[13px]" rows={10} value={finalContent} aria-label="Full instructions (markdown)" onChange={(e) => setRawEdit(e.target.value)} />
          {rawEdit !== null && (
            <Sec className="h-9 text-sm" onClick={() => setRawEdit(null)}>
              Use my answers again
            </Sec>
          )}
        </>
      ) : (
        <AreaBox className="min-h-64 font-mono text-[13px]" rows={14} value={content} aria-label="Full instructions (markdown)" onChange={(e) => setContent(e.target.value)} required />
      )}
    </div>
  );

  return (
    <Dlg title={skill ? `Edit ${skill.name}` : "New skill"} onClose={onClose} wide>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void save();
        }}
      >
        <Labeled label="Name">{(id) => <TextBox id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={guided ? "Summarize a meeting" : "Deploy the web app"} required />}</Labeled>
        {guided ? (
          <>
            <Labeled label="What should your agent do?">{(id) => <AreaBox id={id} rows={3} value={what} onChange={(e) => setWhat(e.target.value)} />}</Labeled>
            <Labeled label="When should it use this?">
              {(id) => <AreaBox id={id} rows={2} value={when} onChange={(e) => setWhen(e.target.value)} maxLength={500} />}
            </Labeled>
            <Labeled label="What does a good result look like?">{(id) => <AreaBox id={id} rows={3} value={result} onChange={(e) => setResult(e.target.value)} />}</Labeled>
          </>
        ) : (
          <Labeled label="When to use it">
            {(id) => <TextBox id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Use when asked to deploy or roll back the web app." />}
          </Labeled>
        )}
        <div className="space-y-2">
          <Label>Tags</Label>
          <TagsInput tags={tags} onChange={setTags} />
        </div>
        {guided ? <MoreOptions title="Edit the instructions directly">{editor}</MoreOptions> : editor}
        <div className="space-y-2">
          <Label>Who can use it</Label>
          <AgentPicker agents={agents} value={agentIds} onChange={setAgentIds} allAgents={{ on: allAgents, onChange: setAllAgents }} />
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {skill && onShare && (
            <Sec onClick={() => onShare(skill)}>
              <Share2 size={15} /> Share
            </Sec>
          )}
          <Prim type="submit" disabled={busy || !canSave} className="h-11 text-body">
            Save skill
          </Prim>
        </div>
      </form>
    </Dlg>
  );
}

const download = (fileName: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Share a skill (a link, a file, or a copy for another helper) and bring one in (a pasted link, a
 * .md file, or the ones your devices' harnesses already have). Without a skill it is only "Bring one in".
 */
export function SkillShare({ skill, agents, canEdit, onClose, onBrought, onDevices }: { skill: Skill | null; agents: Agent[]; canEdit: boolean; onClose: () => void; onBrought: (s: Skill) => void; onDevices: () => void }) {
  const [view, setView] = useState<"home" | "agents" | "paste" | "found">("home");
  const [picked, setPicked] = useState<string[]>(skill?.agentIds ?? []);
  const [pasted, setPasted] = useState("");
  const [found, setFound] = useState<SharedSkill | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const shared = skill ? { name: skill.name, description: skill.description, content: skill.content, tags: skill.tags } : null;

  async function copyLink() {
    if (!shared) return;
    try {
      await navigator.clipboard.writeText(skillLink(shared));
      setNote("Link copied");
    } catch {
      setError("Couldn't copy the link.");
    }
  }
  async function giveCopies() {
    if (!skill) return;
    setBusy(true);
    setError(null);
    try {
      const have = new Set(skill.agentIds);
      for (const id of picked) if (!have.has(id)) await api("PUT", `/api/skills/${skill.id}/agents/${id}`);
      for (const id of skill.agentIds) if (!picked.includes(id)) await api("DELETE", `/api/skills/${skill.id}/agents/${id}`);
      onBrought(skill);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const read = (s: SharedSkill | null) => {
    if (!s) return setError("That isn't a Wisp skill link or a SKILL.md file.");
    setError(null);
    setFound(s);
    setView("found");
  };
  async function bringIn() {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      onBrought(await api<Skill>("POST", "/api/skills", { name: found.name, description: found.description, content: found.content, tags: found.tags, agentIds: [] }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const option = (icon: ReactNode, title: string, onClick: () => void) => <Item icon={<Tile size={40}>{icon}</Tile>} title={title} onClick={onClick} />;

  return (
    <Dlg title={view === "agents" ? "Share with another agent" : view === "paste" ? "Paste a link" : view === "found" ? "Bring it in" : skill ? "Share a skill" : "Bring one in"} onClose={onClose}>
      {view === "home" && (
        <>
          {skill && shared && (
            <Panel>
              {option(<Link2 size={20} strokeWidth={1.7} />, "Copy a link", copyLink)}
              {option(<Download size={20} strokeWidth={1.7} />, "Save as a file", () => download(`${skill.slug}.md`, skillFile(skill)))}
              {canEdit && agents.length > 0 && option(<Users size={20} strokeWidth={1.7} />, "Share with another agent", () => setView("agents"))}
            </Panel>
          )}
          {canEdit && !skill && (
            <>
              <Panel>
                {option(<Link2 size={20} strokeWidth={1.7} />, "Paste a link", () => setView("paste"))}
                {option(<FileText size={20} strokeWidth={1.7} />, "Choose a file", () => file.current?.click())}
                {option(<Laptop size={20} strokeWidth={1.7} />, "From your computers", onDevices)}
              </Panel>
              <input
                ref={file}
                type="file"
                accept=".md,text/markdown,text/plain"
                className="sr-only"
                aria-label="Choose a skill file"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) read(readSkillFile(await f.text(), f.name));
                }}
              />
            </>
          )}
        </>
      )}
      {view === "agents" && skill && (
        <>
          <AgentPicker agents={agents} value={picked} onChange={setPicked} />
          <div className="flex justify-end gap-2">
            <Sec onClick={() => setView("home")}>Back</Sec>
            <Prim className="h-11 text-body" disabled={busy} onClick={giveCopies}>
              Share
            </Prim>
          </div>
        </>
      )}
      {view === "paste" && (
        <>
          <AreaBox rows={4} autoFocus value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="wisp-skill:…" aria-label="Skill link" className="font-mono text-[13px]" />
          <div className="flex justify-end gap-2">
            <Sec onClick={() => setView("home")}>Back</Sec>
            <Prim className="h-11 text-body" disabled={!pasted.trim()} onClick={() => read(readSkillLink(pasted) ?? (pasted.includes("---") || pasted.includes("#") ? readSkillFile(pasted) : null))}>
              Continue
            </Prim>
          </div>
        </>
      )}
      {view === "found" && found && (
        <>
          <Panel>
            <Item icon={<Tile size={50}><Wand2 size={22} strokeWidth={1.7} /></Tile>} title={found.name} sub={<span className="whitespace-normal">{found.description || "No description"}</span>} />
          </Panel>
          <div className="flex justify-end gap-2">
            <Sec onClick={() => setView("home")}>Back</Sec>
            <Prim className="h-11 text-body" disabled={busy} onClick={bringIn}>
              Bring it in
            </Prim>
          </div>
        </>
      )}
      {note && (
        <p role="status" className="px-1 text-sm text-ok">
          {note}
        </p>
      )}
      {error && <p className="px-1 text-sm text-bad">{error}</p>}
    </Dlg>
  );
}
