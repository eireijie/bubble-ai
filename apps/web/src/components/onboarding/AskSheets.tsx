import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Agent } from "@wisp/core";
import type { MemoryLine } from "@wisp/core/src/memory-import.ts";
import { api } from "../../api.ts";
import { go } from "../../router.ts";
import { usableDevices, useDevices } from "../../devices.ts";
import { readyConnection, useConnections } from "../../models.ts";
import { flushNotes, initKnow, startScan, useKnow } from "../../onboardingKnow.ts";
import { askableOn } from "../../views/onboarding/firstAgent.ts";
import { PhonePairing } from "../../views/settings/mobile.tsx";
import { MemoryImport } from "../MemoryImport.tsx";
import { Modal } from "../ui.tsx";
import { OnboardingGhost } from "./OnboardingGhost.tsx";

/**
 * What two of setup's questions open, from the agent's first chat and from "Finish setup": the
 * phone's pairing code, and getting to know you.
 */

/** "Add your phone": the pairing QR code. */
export function PhoneSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Add your phone" onClose={onClose}>
      <PhonePairing autoStart compact />
    </Modal>
  );
}

const quiet = "h-9 shrink-0 rounded-full border border-line2 px-3.5 text-[13px] text-ink hover:bg-hover disabled:opacity-60";

/**
 * "Let me get to know you": look around this computer (what it finds is saved to your notes as it
 * arrives), and bring what your other AI knows (asked for you, or pasted; you tick what to keep
 * and it goes to this agent's memory).
 */
export function KnowSheet({ agent, workspaceId, onClose }: { agent: Pick<Agent, "id" | "name" | "settings">; workspaceId: string; onClose: () => void }) {
  const k = useKnow();
  useEffect(() => initKnow(workspaceId), [workspaceId]);
  // closing keeps what was found: the last notes are written now
  useEffect(() => () => void flushNotes(), []);
  const devices = useDevices();
  const { connections } = useConnections();
  const device = usableDevices(devices ?? []).find((d) => d.mine && d.online && !d.paused);
  const askable = askableOn(
    device,
    ["claude-code", "codex"].map((harness) => ({ harness, connectionId: readyConnection(harness, connections ?? [])?.id ?? null })),
  );
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (lines: MemoryLine[]) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ saved: number }>("POST", `/api/agents/${agent.id}/memory-import`, { lines: lines.map((l) => ({ heading: l.heading, text: l.text })) });
      setSaved(r.saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const scanning = k.scan === "running";
  const found = k.facts.length;
  const seeNotes = () => {
    onClose();
    go({ view: "vault", path: null });
  };
  return (
    <Modal title="Get to know you" onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        {k.available && (
          <section className="flex items-center gap-3" aria-live="polite">
            <OnboardingGhost size={36} working={scanning} follow={false} look={agent.settings.appearance} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-medium text-ink">Look around {k.computer}</h3>
              {(scanning || k.scan === "done") && <p className="text-[13px] leading-5 text-muted">{scanning ? (k.latest ?? "Looking") : found ? `Found ${found} ${found === 1 ? "thing" : "things"}` : "Nothing new"}</p>}
            </div>
            {k.scan === "done" && found > 0 ? (
              <button type="button" className={quiet} onClick={seeNotes}>
                See notes
              </button>
            ) : (
              <button type="button" className={quiet} disabled={scanning} onClick={() => void startScan()}>
                {scanning && <Loader2 size={13} className="mr-1.5 inline animate-spin" aria-hidden />}
                {k.scan === "done" ? "Look again" : "Look"}
              </button>
            )}
          </section>
        )}
        <section className="flex flex-col gap-3">
          <h3 className="text-[14px] font-medium text-ink">Bring what your other AI knows</h3>
          {saved !== null ? (
            <div className="flex items-center gap-3" role="status">
              <p className="flex-1 text-[13px] leading-5 text-muted">
                Kept {saved} {saved === 1 ? "thing" : "things"}
              </p>
              <button type="button" className={quiet} onClick={seeNotes}>
                See notes
              </button>
            </div>
          ) : (
            <MemoryImport agentName={agent.name} askable={askable} saveLabel="Save" onSave={(l) => void save(l)} busy={busy} />
          )}
          {error && (
            <p role="alert" className="text-[13px] text-bad">
              {error}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
