import { useEffect, useRef, useState } from "react";
import { builderCovered, escapeAction } from "./escape.ts";
import { createPortal } from "react-dom";
import { api } from "../api.ts";
import { useStore, type ChannelInfo } from "../store.ts";
import { Button, Modal } from "../components/ui.tsx";
import { TeamBuilder } from "./Builder.tsx";
import { addStep, prepareTeam, withChart, type AddKind } from "./flow.ts";

/** Editing how an existing team works: the builder over the team's own steps, saved to its channel. */
export function TeamEditSession({ channel, onClose, select = null, add = null }: { channel: ChannelInfo; onClose: () => void; /** open with this step's sheet showing */ select?: string | null; /** open with a new step of this kind added and picked (a schedule, from the team panel) */ add?: AddKind | null }) {
  const refreshChannels = useStore((s) => s.refreshChannels);
  const live = useStore((s) => s.channels.find((c) => c.id === channel.id)) ?? channel;
  const agents = useStore((s) => s.agents);
  const [original] = useState(() => prepareTeam(live.settings.team, new Set(agents.map((a) => a.id))));
  // a step asked for on the way in is added to the copy being edited, so leaving without Done drops it again
  const [started] = useState(() => (add ? addStep(original, add, {}, agents) : null));
  const [team, setTeam] = useState(started?.team ?? original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const changed = JSON.stringify(team) !== JSON.stringify(original);

  // The builder sits over a modal that closes on Escape. Take Escape first (before that modal sees it) so it can't drop unsaved edits.
  const latest = useRef({ discarding, changed, onClose });
  latest.current = { discarding, changed, onClose };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const what = escapeAction({ ...latest.current, nested: builderCovered() });
      if (what === "defer") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (what === "keep-editing") setDiscarding(false);
      else if (what === "ask") setDiscarding(true);
      else latest.current.onClose();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // empty roles say to drop them (left out, the hub keeps the old ones)
      await api("PATCH", `/api/channels/${channel.id}`, { settings: { team: withChart({ ...team, roles: team.roles ?? [] }) } });
      await refreshChannels();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TeamBuilder team={team} onChange={setTeam} name={live.name} channelId={channel.id} saving={busy} error={error} select={started?.id ?? select} onBack={() => (changed ? setDiscarding(true) : onClose())} onDone={() => void save()} />
      {discarding &&
        createPortal(
        <Modal title="Discard changes?" onClose={() => setDiscarding(false)}>
          <div className="flex flex-col gap-2">
            <Button type="button" variant="primary" onClick={() => setDiscarding(false)} className="h-11">
              Keep editing
            </Button>
            <Button type="button" variant="danger" onClick={onClose} className="h-11">
              Discard changes
            </Button>
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
