import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Agent } from "@bubble-ai/core";
import { newBubbleLook, type GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { openDm } from "../openDm.ts";
import { Ghost } from "../components/Ghost.tsx";
import { Modal } from "../components/ui.tsx";
import { autoHandle, defaultsNeedPicking, nameProblem, suggestName, type AgentDefaults } from "./CreateAgent.tsx";
import { BubblePicker } from "./AgentShort.tsx";
import { BOARD_COLORS } from "./lookWords.ts";
import "../round11-agent.css";

/**
 * New agent (round 11, board 12): one sheet. Its bubble, a name, a colour, Create. It is made with
 * your defaults (its AI, its computer) and its chat opens, where it says hello and does the rest of
 * the setup. "Describe a look" picks from four bubbles; "More options" is the full New agent
 * dialog, with what was picked here already in it. When there are no defaults to make it with,
 * Create goes on to that dialog. A sheet on phones, a centred pop-up on desktops.
 */
export function NewAgentSheet({ onClose, onMore }: { onClose: () => void; onMore: (picked: { name: string; look: GhostAppearance }) => void }) {
  const agents = useStore((s) => s.agents);
  const refreshAgents = useStore((s) => s.refreshAgents);
  const placeholder = useMemo(() => suggestName(agents), [agents]);
  const [name, setName] = useState("");
  const [look, setLook] = useState<GhostAppearance>(() => ({ ...newBubbleLook(), color: BOARD_COLORS[0].hex }));
  const [describe, setDescribe] = useState(false);
  const [defaults, setDefaults] = useState<AgentDefaults | null | "error">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    api<AgentDefaults>("GET", "/api/settings/agent-defaults").then(
      (d) => on && setDefaults(d),
      () => on && setDefaults("error"),
    );
    return () => {
      on = false;
    };
  }, []);
  const finalName = name.trim() || placeholder;
  const problem = nameProblem(finalName, "", agents);
  const needsMore = defaultsNeedPicking(defaults);

  const create = async () => {
    if (busy || problem) return;
    if (needsMore) return onMore({ name: finalName, look });
    setBusy(true);
    setError(null);
    try {
      const a = await api<Agent>("POST", "/api/agents", { name: finalName, handle: autoHandle(finalName, agents.map((x) => x.handle)), instructions: "", useDefaults: true, settings: { appearance: look } });
      await Promise.all([refreshAgents(), useStore.getState().refreshComputers()]);
      onClose();
      // straight to its chat, where it has already said hello
      await openDm(a.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="New agent" label="New agent" headerless onClose={busy ? () => {} : onClose} className="r11-page flex flex-col max-sm:h-[calc(100dvh-54px)] max-sm:rounded-t-[28px]! sm:max-w-[400px]! sm:rounded-[24px]!" contentClassName="flex flex-1 flex-col items-center p-0! pb-[max(1.5rem,env(safe-area-inset-bottom))]!">
      <div className="grid w-full grid-cols-[40px_1fr_40px] items-center px-4 pt-3.5">
        <button type="button" onClick={onClose} disabled={busy} className="r11-circle bg-[color-mix(in_srgb,var(--ink)_9%,transparent)] hover:bg-[color-mix(in_srgb,var(--ink)_14%,transparent)]" aria-label="Close">
          <X size={18} strokeWidth={2} />
        </button>
        <h1 className="text-center text-[15px] font-semibold">New agent</h1>
      </div>
      {describe ? (
        <div className="w-full pt-1">
          <BubblePicker look={look} onChange={setLook} name={finalName} start="describe" size={104} />
          <button type="button" onClick={() => setDescribe(false)} className="mx-auto mt-3 block text-[13.5px] text-muted hover:text-ink">
            Back to colours
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3.5">
            <Ghost look={look} size={118} label={`${finalName}'s bubble`} />
          </div>
          <div className="mt-[22px] w-full max-w-[300px] px-0">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="Name your agent"
              aria-label="Name your agent"
              maxLength={80}
              className="r11-field"
            />
          </div>
          {problem && name.trim() && <p className="mt-2 text-[13px] text-st-needs">{problem}</p>}
          <div role="radiogroup" aria-label="Colour" className="mt-[26px] grid grid-cols-6 gap-x-4 gap-y-3.5 [--sw-gap:var(--r11-page)]">
            {BOARD_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={look.color?.toLowerCase() === c.hex}
                aria-label={c.name}
                title={c.name}
                onClick={() => setLook({ ...look, color: c.hex, color2: undefined })}
                className="r11-sw"
                style={{ background: `radial-gradient(circle at 34% 28%, color-mix(in srgb, ${c.hex} 35%, white), ${c.hex} 70%)` }}
              />
            ))}
          </div>
          <p className="mt-5 text-[13.5px] text-muted">
            Or{" "}
            <button type="button" onClick={() => setDescribe(true)} className="r11-link">
              describe a look
            </button>{" "}
            ·{" "}
            <button type="button" onClick={() => onMore({ name: finalName, look })} className="r11-link">
              more options
            </button>
          </p>
        </>
      )}
      <div className="min-h-6 flex-1" />
      {error && <p className="mb-3 max-w-[300px] text-center text-[13px] text-bad">{error}</p>}
      <div className="w-full max-w-[300px]">
        <button type="button" onClick={() => void create()} disabled={busy || !!problem || defaults === null} className="r11-create">
          {busy ? <Loader2 size={17} className="animate-spin" /> : null}
          {needsMore ? "Continue" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
