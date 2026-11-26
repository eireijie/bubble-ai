import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../overlays.ts";
import { builderCovered } from "./escape.ts";
import { ArrowUp, ChevronLeft, Loader2, MoreHorizontal, Plus, X } from "lucide-react";
import { TEAM_TEMPLATES, type ChannelTeam, type TeamDraft, type TeamTemplate } from "@bubble-ai/core";
import { api } from "../api.ts";
import { inkOn } from "../chatTint.ts";
import { useStore } from "../store.ts";
import { AgentAvatar, Button, Menu, Modal, agentColor, cx } from "../components/ui.tsx";
import { StepCanvas } from "./Canvas.tsx";
import { useFlowLines } from "./How.tsx";
import { AddStepSheet, PhoneFlow, ReorderSheet } from "./Phone.tsx";
import { useRunningSteps } from "./Runs.tsx";
import { StepForm, stepHeading } from "./StepForm.tsx";
import { TemplateBrowser } from "./Templates.tsx";
import { useIsPhone } from "./parts.tsx";
import { CreateAgentContext, NewAgentForTeam } from "./NewAgent.tsx";
import { addStep, builderLead, castFor, castFrom, changeRequest, fillTemplate, relayout, removingStep, isStepDeleteKey, stepById, stepNeedsConfirm, stepProblems, teamFromSteps, updating, withChart, type AddAt, type AddKind } from "./flow.ts";

export interface BuilderProps {
  team: ChannelTeam;
  onChange: (team: ChannelTeam) => void;
  name: string;
  /** the team's channel once it exists (to save it as a template, to leave it out of the hand-off list, and to light up the step a request is on) */
  channelId?: string;
  saving?: boolean;
  /** what the hub said when saving didn't work */
  error?: string | null;
  doneLabel?: string;
  /** Done works with no steps at all (a new team whose agents were picked by name) */
  allowEmpty?: boolean;
  /** why Done can't be pressed yet, beyond what the steps themselves need (a new team with too few agents) */
  blocked?: string | null;
  /** open with this step's sheet showing */
  select?: string | null;
  /** who the field at the bottom talks to while the steps name nobody */
  leadId?: string | null;
  /** the agents picked for a new team by name: a template casts them, not everyone in the workspace */
  pool?: string[];
  onBack: () => void;
  onDone: () => void;
}

/** The steps as a shape (who leads to whom), so the chart is laid out again only when that changes. */
const shape = (t: ChannelTeam) => JSON.stringify((t.steps ?? []).map((s) => [s.id, s.inputs, s.nexts, s.ifTrue, s.ifFalse]));

/** Three ways a team can work, said in a few words: a start for the field at the bottom while the chart is empty. */
const TRIES = ["One builds, one reviews", "Research, then I approve", "Triage, reply, check"];

/**
 * The team builder: a window of its own over the whole app. Back, the team's name and Done; the
 * steps as cards joined by arrows (a + on each arrow adds one); a step's sheet at the right when
 * one is picked; and one field at the bottom to tell the lead how the team should work. At phone
 * width the steps run top to bottom and a step opens as a sheet.
 */
export function TeamBuilder({ team, onChange, name, channelId, saving = false, error = null, doneLabel = "Done", allowEmpty = false, blocked = null, select = null, leadId = null, pool, onBack, onDone }: BuilderProps) {
  const phone = useIsPhone();
  const overlayId = useRef(Symbol("builder")).current;
  useOverlay(overlayId, "builder");
  const agents = useStore((s) => s.agents);
  const [sel, setSel] = useState<string | null>(phone ? null : select);
  const [editing, setEditing] = useState<string | null>(phone ? select : null);
  const [adding, setAdding] = useState<AddAt | null>(null);
  const [reordering, setReordering] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [naming, setNaming] = useState(false);
  const [newAgent, setNewAgent] = useState<((id: string) => void) | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [holding, setHolding] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const manual = useRef(new Set<string>());
  const working = useRunningSteps(channelId);

  const steps = team.steps ?? [];
  const problems = useMemo(() => stepProblems(team), [team]);
  const problem = steps.length ? (problems.lines[0] ?? blocked) : allowEmpty ? blocked : "Add a step first";
  const ready = !problem;

  // steps that were never laid out (an agent drew them, or an older chart) get a place on the chart
  useEffect(() => {
    if (steps.length > 1 && steps.every((s) => s.x === steps[0].x && s.y === steps[0].y)) {
      onChange(relayout(team));
      setFitKey((k) => k + 1);
    }
    // once, when the builder opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Every change comes through here: the chart is laid out again when the arrows changed, and kept in step with the plain chart. */
  const commit = (next: ChannelTeam) => {
    const laid = shape(next) !== shape(team) ? relayout(next, manual.current) : next;
    onChange(withChart(laid));
  };

  const open = (id: string | null) => (phone ? setEditing(id) : setSel(id));

  const add = (kind: AddKind, at: AddAt) => {
    // the picked lead and the team's agents first, so a step on an empty canvas goes to one of them
    const made = addStep(team, kind, at, castFor(agents, leadId, pool));
    commit(made.team);
    setAdding(null);
    // the first step on an empty canvas: the view was fitted to nothing, so fit it again
    if (!steps.length) setFitKey((k) => k + 1);
    // straight to the new step, to say what it does
    setTimeout(() => open(made.id), phone ? 150 : 0);
  };

  const remove = (id: string) => {
    commit(removingStep(team, id));
    setSel(null);
    setEditing(null);
  };

  /** Delete straight away, unless the step has a prompt or arrows: then ask first. */
  const askRemove = (id: string) => {
    if (stepNeedsConfirm(team, id)) setConfirmDelete(id);
    else remove(id);
  };

  // Delete or Backspace takes off the picked step (on a desktop, when not typing in a field)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (phone) return;
    if (!isStepDeleteKey(e, sel && stepById(team, sel) ? sel : null, builderCovered())) return;
    e.preventDefault();
    askRemove(sel!);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const useTemplate = (t: TeamTemplate) => {
    manual.current.clear();
    onChange(fillTemplate(t, castFrom(agents, pool), team));
    setTemplates(false);
    setSel(null);
    setFitKey((k) => k + 1);
  };

  const tidy = () => {
    manual.current.clear();
    onChange(relayout(team));
    setFitKey((k) => k + 1);
  };

  // --- "Tell {lead} how the team should work": an agent draws the steps from a sentence -----------
  const [leadPick, setLeadPick] = useState<string | null>(null);
  const [workspaceLead, setWorkspaceLead] = useState<string | null>(null);
  useEffect(() => {
    api<{ lead: string | null }>("GET", "/api/settings/lead")
      .then((r) => setWorkspaceLead(r.lead))
      .catch(() => {});
  }, []);
  const lead = agents.find((a) => a.id === (leadPick ?? builderLead(team, agents, leadId, workspaceLead)));
  const lines = useFlowLines(team);
  const [text, setText] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const token = useRef(0);
  useEffect(() => () => void (token.current += 1), []);
  const latest = useRef(team);
  latest.current = team;

  const tell = async () => {
    const ask = text.trim();
    if (!ask || !lead || drawing) return;
    const mine = ++token.current;
    setDrawing(true);
    setFailure(null);
    try {
      let d = await api<TeamDraft>("POST", "/api/team-drafts", { description: changeRequest(ask, lines), agentId: lead.id });
      while (d.status === "working") {
        await new Promise((r) => setTimeout(r, 1500));
        if (mine !== token.current) return;
        d = await api<TeamDraft>("GET", `/api/team-drafts/${d.id}`);
      }
      if (mine !== token.current) return;
      if (d.status === "ready" && d.steps?.length) {
        manual.current.clear();
        onChange(teamFromSteps(d.steps, latest.current));
        setSel(null);
        setEditing(null);
        setText("");
        setFitKey((k) => k + 1);
      } else setFailure(d.problem ?? "Try saying it another way.");
    } catch (e) {
      if (mine === token.current) setFailure((e as Error).message);
    } finally {
      if (mine === token.current) setDrawing(false);
    }
  };

  // why Done waits, said beside it (the steps' own problems already show in the banner over the chart)
  const reason = !ready && !saving && !drawing && !(steps.length > 0 && problems.lines.length > 0) ? problem : null;

  const banner = (error || (problems.lines.length > 0 && steps.length > 0)) && (
    <p role="alert" aria-label="Problems" className="mx-auto w-fit max-w-full rounded-[8px] bg-bad/12 px-3.5 py-1.5 text-center text-[13px] text-bad">
      {error ?? problems.lines[0]}
      {!error && problems.lines.length > 1 && ` (and ${problems.lines.length - 1} more)`}
    </p>
  );

  const menu = (
    <Menu
      align="right"
      trigger={(isOpen, toggle) => (
        <button type="button" onClick={toggle} aria-expanded={isOpen} aria-haspopup="menu" aria-label="More" className="circle circle-sm shrink-0">
          <MoreHorizontal size={18} />
        </button>
      )}
      items={[
        { label: "Templates", onSelect: () => setTemplates(true) },
        ...(phone ? (steps.length > 1 ? [{ label: "Reorder steps", onSelect: () => setReordering(true) }] : []) : [{ label: "Tidy up", onSelect: tidy }]),
        ...(channelId ? [{ label: "Save as template", onSelect: () => setNaming(true) }] : []),
      ]}
    />
  );

  const selected = sel ? stepById(team, sel) : undefined;
  const form = (id: string) => <StepForm team={team} stepId={id} onChange={commit} onDelete={() => askRemove(id)} channelId={channelId} />;
  const empty = <EmptyState onAdd={() => (phone ? setAdding({}) : add("agent", {}))} onTemplates={() => setTemplates(true)} onTemplate={useTemplate} />;

  return createPortal(
    <CreateAgentContext.Provider value={(done) => setNewAgent(() => done)}>
    <div role="dialog" data-team-builder aria-label={`How ${name} works`} className="fixed inset-0 z-50 flex flex-col bg-panel text-ink safe-top">
      <header className="flex h-[60px] shrink-0 items-center gap-2 px-3 md:px-4">
        <button type="button" onClick={onBack} aria-label="Back" className="circle circle-sm shrink-0">
          <ChevronLeft size={19} />
        </button>
        <h1 className={cx("min-w-0 flex-1 truncate text-[15px] font-semibold", phone ? "text-center" : "pl-1")}>{name}</h1>
        {reason && !phone && (
          <span role="status" className="max-w-[18rem] truncate text-[13px] text-muted">
            {reason}
          </span>
        )}
        {menu}
        <Button type="button" variant="primary" onClick={onDone} disabled={!ready || saving || drawing} title={problem ?? undefined} className="shrink-0 px-4">
          {saving ? <Loader2 size={15} className="animate-spin" aria-label="Saving" /> : doneLabel}
        </Button>
      </header>
      {reason && phone && (
        <p role="status" className="-mt-1 shrink-0 px-4 pb-1.5 text-center text-[13px] text-muted">
          {reason}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        {phone ? (
          <div className="min-w-0 flex-1 overflow-y-auto">
            {steps.length === 0 ? <div className="relative h-full">{empty}</div> : <PhoneFlow team={team} problems={problems.byStep} working={working} banner={banner ? <div className="mb-4 w-full">{banner}</div> : null} onOpen={open} onHold={setHolding} onAdd={setAdding} onSchedule={() => add("schedule", {})} />}
          </div>
        ) : (
          <>
            <div className="relative min-w-0 flex-1">
              <StepCanvas
                team={team}
                selected={sel}
                problems={problems.byStep}
                fitKey={fitKey}
                working={working}
                onSelect={setSel}
                onDelete={askRemove}
                onMove={(id, pos) => {
                  manual.current.add(id);
                  onChange(updating(team, id, pos));
                }}
                onAdd={add}
                empty={steps.length === 0 ? empty : null}
              />
              {banner && <div className="pointer-events-none absolute inset-x-4 top-3 z-10">{banner}</div>}
            </div>
            {selected && (
              <aside aria-label="Step" className="m-details flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-line bg-panel">
                <div className="flex h-14 w-[360px] shrink-0 items-center justify-between gap-2 px-4">
                  <h2 className="min-w-0 truncate text-[15px] font-semibold">{stepHeading(team, selected)}</h2>
                  <button type="button" onClick={() => setSel(null)} aria-label="Close" className="circle circle-sm shrink-0">
                    <X size={16} />
                  </button>
                </div>
                <div className="min-h-0 w-[360px] flex-1 overflow-y-auto px-4 pb-6" data-scroll>
                  {form(selected.id)}
                </div>
              </aside>
            )}
          </>
        )}
        {(saving || drawing) && (
          <div className="absolute inset-0 z-30 grid place-items-center bg-panel/60" role="status">
            {drawing && lead ? (
              <div className="flex flex-col items-center gap-2">
                <AgentAvatar agent={{ ...lead, status: "busy" }} size={56} live />
                <span className="text-[14px] text-muted">{lead.name} is drawing</span>
              </div>
            ) : (
              <Loader2 size={22} className="animate-spin text-muted" aria-label="Saving" />
            )}
          </div>
        )}
      </div>

      <form
        className="mx-auto w-full max-w-[592px] shrink-0 space-y-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void tell();
        }}
      >
        {steps.length === 0 && lead && !drawing && (
          <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Try">
            {TRIES.map((t) => (
              <button key={t} type="button" onClick={() => setText(t)} className="h-8 rounded-[8px] border border-line px-3 text-[13px] text-muted hover:bg-hover hover:text-ink">
                {t}
              </button>
            ))}
          </div>
        )}
        {failure && (
          <p role="alert" className="text-center text-[13px] text-bad">
            It couldn't draw that. {failure}
          </p>
        )}
        <div className="flex h-[46px] items-center gap-1.5 rounded-[20px] border border-line bg-card pl-2 pr-1.5 focus-within:border-ring">
          {lead && agents.length > 1 ? (
            <Menu
              up
              trigger={(isOpen, toggle) => (
                <button type="button" onClick={toggle} aria-expanded={isOpen} aria-haspopup="menu" aria-label={`${lead.name} builds it. Pick another agent`} className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <AgentAvatar agent={lead} size={30} interactive={false} />
                </button>
              )}
              items={agents.map((a) => ({ label: a.name, icon: <AgentAvatar agent={a} size={18} interactive={false} />, onSelect: () => setLeadPick(a.id) }))}
            />
          ) : (
            lead && <AgentAvatar agent={lead} size={30} interactive={false} />
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!lead || drawing}
            maxLength={600}
            placeholder={lead ? (phone ? `Tell ${lead.name} how it should work` : `Tell ${lead.name} how the team should work`) : "Add an agent first"}
            aria-label={lead ? `Tell ${lead.name} how the team should work` : "Tell the lead how the team should work"}
            className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[14px] outline-none placeholder:text-faint"
          />
          <button type="submit" disabled={!text.trim() || !lead || drawing} aria-label="Send" className="grid size-[34px] shrink-0 place-items-center rounded-full disabled:opacity-40" style={lead ? { background: agentColor(lead), color: inkOn(agentColor(lead)) } : { background: "var(--chip)" }}>
            <ArrowUp size={16} strokeWidth={2.4} />
          </button>
        </div>
      </form>

      {phone && editing && stepById(team, editing) && (
        <Modal title={stepHeading(team, stepById(team, editing)!)} onClose={() => setEditing(null)} label="Step">
          {form(editing)}
        </Modal>
      )}
      {holding && stepById(team, holding) && (
        <Modal title={stepHeading(team, stepById(team, holding)!)} onClose={() => setHolding(null)} label="Step actions">
          <div className="space-y-2">
            <Button type="button" className="h-12 w-full text-body" onClick={() => { const id = holding; setHolding(null); setEditing(id); }}>
              Edit step
            </Button>
            <Button type="button" variant="danger" className="h-12 w-full text-body" onClick={() => { const id = holding; setHolding(null); askRemove(id); }}>
              Delete step
            </Button>
          </div>
        </Modal>
      )}
      {confirmDelete && stepById(team, confirmDelete) && (
        <Modal title="Delete this step?" onClose={() => setConfirmDelete(null)}>
          <p className="text-body text-muted">What led to it will lead to what came after it.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={() => { const id = confirmDelete; setConfirmDelete(null); remove(id); }}>
              Delete step
            </Button>
          </div>
        </Modal>
      )}
      {adding && <AddStepSheet team={team} at={adding} onPick={(kind, a) => add(kind, adding.between ? adding : { after: a })} onClose={() => setAdding(null)} />}
      {reordering && <ReorderSheet team={team} onChange={commit} onClose={() => setReordering(false)} />}
      {templates && <TemplateBrowser onClose={() => setTemplates(false)} onUse={useTemplate} />}
      {naming && channelId && <SaveTemplate channelId={channelId} onClose={() => setNaming(false)} />}
      {newAgent && (
        <NewAgentForTeam
          onClose={() => setNewAgent(null)}
          onCreated={(a) => {
            newAgent(a.id);
            setNewAgent(null);
          }}
        />
      )}
    </div>
    </CreateAgentContext.Provider>,
    document.body,
  );
}

/** An empty chart: one plus for the first step, the first three ready-made teams by name, and the rest behind "Templates". */
function EmptyState({ onAdd, onTemplates, onTemplate }: { onAdd: () => void; onTemplates: () => void; onTemplate: (t: TeamTemplate) => void }) {
  return (
    <div className="absolute inset-0 z-[5] grid place-items-center p-6 text-center" data-ui>
      <div className="flex max-w-[460px] flex-col items-center gap-4">
        <button type="button" onClick={onAdd} aria-label="Add a step" className="grid size-12 place-items-center rounded-full bg-accent text-accent-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <Plus size={20} strokeWidth={2.2} />
        </button>
        <div className="flex flex-wrap justify-center gap-1.5">
          {TEAM_TEMPLATES.slice(0, 3).map((t) => (
            <button key={t.id} type="button" onClick={() => onTemplate(t)} title={t.blurb} className="h-8 rounded-[8px] border border-line bg-panel px-3 text-[13px] hover:bg-hover">
              {t.name}
            </button>
          ))}
          <button type="button" onClick={onTemplates} className="h-8 rounded-[8px] px-2.5 text-[13px] text-muted hover:text-ink">
            Templates
          </button>
        </div>
      </div>
    </div>
  );
}

/** Save the team's steps as a template anyone here can start from (who does each step is left out). */
export function SaveTemplate({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | string>("idle");
  return (
    <Modal title="Save as template" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setState("saving");
          try {
            await api("POST", "/api/team-templates", { channelId, name: name.trim() });
            onClose();
          } catch (err) {
            setState((err as Error).message);
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" maxLength={60} aria-label="Template name" autoFocus className="h-11 w-full rounded-2xl border border-input bg-transparent px-3.5 text-body outline-none focus:border-ring" />
        <p className="text-xs text-muted">Who does each step is left out. Unsaved changes are not included.</p>
        {state !== "idle" && state !== "saving" && <p className="text-sm text-bad">{state}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || state === "saving"}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
