import { useEffect, useRef, useState } from "react";
import { harnessLabel } from "@bubble-ai/core";
import { memoryPrompt, parseMemoryAnswer } from "@bubble-ai/core/src/memory-import.ts";
import "../../round11-settings.css";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { href } from "../../router.ts";
import { useDevices } from "../../devices.ts";
import { copyText } from "../../clipboard.ts";

const ALL = "all";

/**
 * Import memory (round 11, board 14): copy one prompt into ChatGPT, Gemini or Claude, paste its
 * answer back, and it becomes notes your agents can use. Lines that look like a secret are left
 * out. An AI tool on one of your computers can be asked instead, and an agent that opens the prompt's
 * one-time link fills the box by itself.
 */
export function ImportMemoryPage() {
  const agents = useStore((s) => s.agents);
  const me = useStore((s) => s.me);
  const devices = useDevices();
  const mine = agents.filter((a) => a.settings.createdBy === me?.user.id || me?.role === "owner");
  const [into, setInto] = useState<string>(ALL);
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // a one-time link an agent can send its answer to, when this Bubble AI can make one
  useEffect(() => {
    api<{ id: string; url: string }>("POST", "/api/memory-links").then((l) => alive.current && setLink(l), () => {});
  }, []);
  useEffect(() => {
    if (!link || answer.trim()) return;
    const t = setInterval(async () => {
      const r = await api<{ answer: string | null; expired: boolean }>("GET", `/api/memory-links/${link.id}`).catch(() => null);
      if (r?.answer) {
        clearInterval(t);
        if (alive.current) setAnswer(r.answer);
      } else if (r?.expired) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [link, answer]);

  const prompt = memoryPrompt(link?.url);
  const askable = (devices ?? []).filter((d) => d.mine && d.online).flatMap((d) => ["claude-code", "codex"].filter((h) => d.harnesses?.some((x) => x.id === h)).map((harness) => ({ harness, nodeId: d.id, device: d.name })));
  const first = askable[0];

  const copy = async () => {
    try {
      await copyText(prompt);
      setCopied(true);
      setError(null);
    } catch {
      setError("Couldn't copy. Select the prompt and copy it.");
    }
  };

  const ask = async () => {
    if (!first) return;
    setError(null);
    setBusy(`${harnessLabel(first.harness)} is writing down what it knows. This can take a few minutes.`);
    try {
      const { id } = await api<{ id: string }>("POST", "/api/memory-prompt/ask", { nodeId: first.nodeId, harness: first.harness });
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!alive.current) return;
        const r = await api<{ status: "running" | "done" | "failed"; answer?: string; error?: string }>("GET", `/api/memory-prompt/ask/${id}`);
        if (r.status === "running") continue;
        if (r.status === "failed") throw new Error(r.error ?? `${harnessLabel(first.harness)} didn't answer`);
        setAnswer(r.answer ?? "");
        break;
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const add = async () => {
    const parsed = parseMemoryAnswer(answer);
    if (!parsed.lines.length) {
      setError(parsed.dropped ? "Everything in that answer looked private, so nothing was kept." : "That answer had nothing Bubble AI could read. Paste the whole reply, with its headings.");
      return;
    }
    const targets = into === ALL ? mine : mine.filter((a) => a.id === into);
    if (!targets.length) return;
    setError(null);
    setBusy("Adding to memory…");
    try {
      const lines = parsed.lines.map((l) => ({ heading: l.heading, text: l.text }));
      let saved = 0;
      for (const a of targets) saved = Math.max(saved, (await api<{ saved: number }>("POST", `/api/agents/${a.id}/memory-import`, { lines })).saved);
      if (!alive.current) return;
      setDone(`Added ${saved} ${saved === 1 ? "line" : "lines"}${parsed.dropped ? `. ${parsed.dropped} private ${parsed.dropped === 1 ? "line was" : "lines were"} left out` : ""}.`);
      setAnswer("");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  if (!mine.length) return <p className="r11s-note px-1">Make an agent first. Its memory is where this goes.</p>;

  return (
    <div className="r11s flex max-w-[520px] flex-col">
      <div className="text-[15px] font-semibold">1 · Copy this into ChatGPT, Gemini or Claude</div>
      <div className="r11s-grp r11s-prompt mt-2.5 max-h-[96px] overflow-hidden p-3.5 text-[13.5px] leading-[19px] text-muted select-all [mask-image:linear-gradient(#000_60%,transparent)]">{prompt}</div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
        <button type="button" onClick={() => void copy()} className="text-[14.5px] font-medium text-[#0a84ff] outline-none hover:underline focus-visible:underline">
          {copied ? "Copied" : "Copy prompt"}
        </button>
        {first && (
          <button type="button" disabled={!!busy} onClick={() => void ask()} className="text-[14px] text-muted outline-none hover:text-ink hover:underline disabled:opacity-50">
            Or ask {harnessLabel(first.harness)} on {first.device}
          </button>
        )}
      </div>

      <div className="mt-2 text-[15px] font-semibold">2 · Paste its answer here</div>
      <textarea className="r11s-box mt-2.5" placeholder="Paste the answer…" aria-label="The answer" value={answer} onChange={(e) => (setAnswer(e.target.value), setDone(null))} />
      {mine.length > 1 && (
        <label className="mt-3 flex items-center gap-2 text-[14px] text-muted">
          Add to
          <select value={into} onChange={(e) => setInto(e.target.value)} className="h-8 rounded-[10px] border border-line bg-[var(--r11-card,var(--card))] px-2 text-[14px] text-ink">
            <option value={ALL}>All your agents</option>
            {mine.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mt-[18px] flex justify-center">
        <button type="button" className="r11s-btn" disabled={!answer.trim() || !!busy} onClick={() => void add()}>
          Add to memory
        </button>
      </div>
      {busy && (
        <p role="status" className="r11s-note mt-3 text-center">
          {busy}
        </p>
      )}
      {done && (
        <p role="status" className="mt-3 text-center text-[13.5px]">
          {done}{" "}
          <a href={href({ view: "vault", path: null })} className="font-medium text-[#0a84ff] hover:underline">
            Open Memory
          </a>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-center text-[13px] text-bad">
          {error}
        </p>
      )}
      <p className="r11s-note px-3.5 pt-3.5 text-center">{into !== ALL ? `Only ${mine.find((a) => a.id === into)?.name ?? "this agent"} gets it.` : mine.length === agents.length ? "Every agent can use it." : "Your agents can use it."} You can see and delete each note in Memory.</p>
    </div>
  );
}
