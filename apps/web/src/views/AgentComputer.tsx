import { useEffect, useState } from "react";
import { CalendarClock, FileText, MoreHorizontal, Play, Plus, Trash2 } from "lucide-react";
import { describeCron, harnessInfo, nextRun, type Agent, type Routine } from "@bubble-ai/core";
import { api } from "../api.ts";
import { useStore } from "../store.ts";
import { go } from "../router.ts";
import { agentReadiness, useDevices, type DeviceInfo } from "../devices.ts";
import { CARD } from "./AgentSections.tsx";
import { Button, Field, Input, Menu, Modal, Textarea, timeAgo } from "../components/ui.tsx";
import { MoreOptions } from "../components/MoreOptions.tsx";

/** Harnesses Bubble AI starts on a device (natively or over ACP), as opposed to ones that join through MCP. */
export function runsOnDevice(harness: string) {
  return harness.startsWith("acp:") || (harnessInfo(harness)?.protocol ?? "mcp") !== "mcp";
}

// --- Routines ---------------------------------------------------------------------------------------

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Longest name the hub accepts for a routine. */
const NAME_MAX = 80;

/** A short routine name from what the person wants done: the first sentence, cut at a word. */
export function routineName(name: string, result: string): string {
  const given = name.trim();
  if (given) return given.slice(0, NAME_MAX);
  const first = (result.trim().split(/[.!?\n]/)[0] ?? "").replace(/\s+/g, " ").trim();
  if (first.length <= 50) return first;
  const cut = first.slice(0, 50);
  return (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trim() + "…";
}

/** The steps text saved with a routine: the goal first, then any steps the person wrote. */
export function routineSteps(result: string, steps: string): string {
  const goal = result.trim();
  const body = steps.trim();
  if (!goal) return steps;
  return body ? `Goal: ${goal}\n\n${body}` : `Goal: ${goal}\n\nNo steps were written. Work out the steps yourself, and adapt if something looks different next time.`;
}

/** Why a new routine can't be saved yet (null = fine). The hub needs a name of 1 to 80 characters. */
export function routineProblem(name: string, result: string): string | null {
  if (!result.trim()) return "Say what should happen.";
  if (!routineName(name, result)) return "Give the routine a name.";
  return null;
}

/** What the agent's schedules are waiting for: its device's name (or "a device"), or null when the device is connected or unknown. */
export function routinesWaitingFor(agent: Pick<Agent, "id" | "nodeId" | "harness" | "settings" | "computerId">, devices: DeviceInfo[] | null): string | null {
  if (agentReadiness(agent, devices).ready) return null;
  if (!agent.nodeId) return "a device";
  const device = devices?.find((d) => d.id === agent.nodeId);
  return device && (!device.online || device.paused) ? device.name : null;
}

/** Tasks the agent does again, written down, some on a schedule. (Teaching a task makes a skill, under Can use.) */
/** A new routine to start writing, filled in already (the profile's "Create a routine" suggestion). */
export interface RoutineDraft {
  result: string;
  schedule: string | null;
}

export function RoutinesPanel({ agent, active, start, onStarted }: { agent: Agent; active: boolean; start?: RoutineDraft | null; onStarted?: () => void }) {
  const version = useStore((s) => s.routinesVersion);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const waitingFor = routinesWaitingFor(agent, useDevices());
  const [writing, setWriting] = useState<RoutineDraft | false>(false);
  useEffect(() => {
    if (!start) return;
    setWriting(start);
    onStarted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  const [scheduling, setScheduling] = useState<Routine | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (active) api<Routine[]>("GET", `/api/routines?agent=${agent.id}`).then(setRoutines, () => setRoutines([]));
  }, [active, agent.id, version]);

  const run = async (r: Routine) => {
    setError(null);
    try {
      const res = await api<{ channelId: string }>("POST", `/api/routines/${r.id}/run`);
      await useStore.getState().refreshChannels();
      go({ view: "chat", channelId: res.channelId, threadId: null });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setWriting({ result: "", schedule: null })}>
          <Plus size={15} /> New
        </Button>
      </div>
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}
      {routines === null ? (
        <p className="px-1 text-[13px] text-muted">Loading…</p>
      ) : routines.length === 0 ? (
        <p className="px-1 text-[13px] text-muted">None yet</p>
      ) : (
        <div className={CARD}>
          {routines.map((r) => {
            const next = r.schedule && r.enabled && r.status === "ready" ? nextRun(r.schedule, r.timezone) : null;
            // one line: its state when it isn't simply on, when it runs, and what it is waiting for
            const when = r.schedule ? `${describeCron(r.schedule)}${r.timezone !== TZ ? ` (${r.timezone})` : ""}` : "When asked";
            const line = [!r.enabled ? "Paused" : null, when, next && waitingFor ? `waits for ${waitingFor}` : null].filter(Boolean).join(" · ");
            const details = [next ? `Next ${next.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : null, r.lastRunAt ? `last asked ${timeAgo(r.lastRunAt)}` : null, r.lastCompletedAt ? `last done ${timeAgo(r.lastCompletedAt)}` : null].filter(Boolean).join(" · ");
            return (
              <div key={r.id} className="flex min-h-[54px] items-center gap-2 px-3.5 py-1.5 text-[14px]">
                <button type="button" onClick={() => setScheduling(r)} title={details || undefined} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-[13px] text-muted">{line}</span>
                </button>
                <Button className="h-8!" disabled={r.status !== "ready"} onClick={() => run(r)}>
                  <Play size={14} /> Run now
                </Button>
                <Menu
                  align="right"
                  items={[
                    { label: "Steps", icon: <FileText size={15} />, onSelect: () => go({ view: "vault", path: r.notePath }) },
                    { label: "Schedule", icon: <CalendarClock size={15} />, onSelect: () => setScheduling(r) },
                    "divider",
                    {
                      label: "Delete",
                      icon: <Trash2 size={15} />,
                      danger: true,
                      onSelect: async () => {
                        if (!confirm(`Delete the routine "${r.name}"? Its steps stay in memory.`)) return;
                        await api("DELETE", `/api/routines/${r.id}`);
                      },
                    },
                  ]}
                  trigger={(open, toggle) => (
                    <button type="button" onClick={toggle} aria-expanded={open} aria-label={`More for ${r.name}`} className="circle circle-sm shrink-0">
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                />
              </div>
            );
          })}
        </div>
      )}
      {writing && <WriteRoutine agent={agent} initial={writing} onClose={() => setWriting(false)} />}
      {scheduling && <ScheduleDialog routine={scheduling} onClose={() => setScheduling(null)} />}
    </div>
  );
}

function WriteRoutine({ agent, initial, onClose }: { agent: Agent; initial: RoutineDraft; onClose: () => void }) {
  const [result, setResult] = useState(initial.result);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState("");
  const [schedule, setSchedule] = useState<string | null>(initial.schedule);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`New routine for ${agent.name}`} onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const problem = routineProblem(name, result);
          if (problem) return setError(problem);
          try {
            await api("POST", "/api/routines", { agentId: agent.id, name: routineName(name, result), steps: routineSteps(result, steps), schedule, timezone: TZ });
            onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <Field label="What should happen?">
          <Textarea rows={3} value={result} onChange={(e) => setResult(e.target.value)} placeholder="Send me three dinner ideas with a shopping list" required />
        </Field>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <MoreOptions about="name and steps">
          <div className="space-y-4">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dinner ideas" />
            </Field>
            <Field label="Steps">
              <Textarea rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="1. Look at what is in the fridge" />
            </Field>
          </div>
        </MoreOptions>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary">Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleDialog({ routine, onClose }: { routine: Routine; onClose: () => void }) {
  const [schedule, setSchedule] = useState(routine.schedule);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={`When does "${routine.name}" run?`} onClose={onClose}>
      <div className="space-y-4">
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> On
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api("PATCH", `/api/routines/${routine.id}`, { schedule, enabled, timezone: TZ });
                onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Preset = "none" | "daily" | "weekdays" | "weekly" | "hourly" | "custom";

function presetOf(cron: string | null): { preset: Preset; time: string; day: number } {
  const m = cron?.match(/^(\d+) (\d+) \* \* (\*|1-5|\d)$/);
  if (!cron) return { preset: "none", time: "09:00", day: 1 };
  if (cron === "0 * * * *") return { preset: "hourly", time: "09:00", day: 1 };
  if (!m) return { preset: "custom", time: "09:00", day: 1 };
  const time = `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
  return m[3] === "*" ? { preset: "daily", time, day: 1 } : m[3] === "1-5" ? { preset: "weekdays", time, day: 1 } : { preset: "weekly", time, day: Number(m[3]) };
}

/** Plain choices ("every weekday at 9:00") that write a cron schedule; custom cron for the rest. */
function ScheduleEditor({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const init = presetOf(value);
  const [preset, setPreset] = useState<Preset>(init.preset);
  // an existing custom schedule stays in plain view; a new one is typed under More options
  const [startedCustom] = useState(init.preset === "custom");
  const [time, setTime] = useState(init.time);
  const [day, setDay] = useState(init.day);
  const [custom, setCustom] = useState(value ?? "0 9 * * 1-5");
  const [h, m] = time.split(":").map(Number);
  const at = `${m || 0} ${h || 0}`;
  const cron = preset === "none" ? null : preset === "hourly" ? "0 * * * *" : preset === "daily" ? `${at} * * *` : preset === "weekdays" ? `${at} * * 1-5` : preset === "weekly" ? `${at} * * ${day}` : custom.trim();
  useEffect(() => {
    onChange(cron);
  }, [cron]);
  const selectCls = "h-9 rounded-lg border border-line bg-panel px-2 text-sm";
  // a custom schedule stays out of the list, but one that is already set is never hidden.
  const customInput = (
    <label className="flex flex-col gap-1 text-xs text-muted">
      Custom schedule (cron)
      <Input
        className="w-48 font-mono"
        value={custom}
        onChange={(e) => {
          setCustom(e.target.value);
          setPreset("custom");
        }}
        placeholder="0 9 * * 1-5"
      />
    </label>
  );
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Schedule</span>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-xs text-muted">
          How often
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={selectCls}>
            <option value="none">Only when someone runs it</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Every week</option>
            <option value="hourly">Every hour</option>
            {preset === "custom" && <option value="custom">Custom schedule</option>}
          </select>
        </label>
        {preset === "weekly" && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Day
            <select value={day} onChange={(e) => setDay(Number(e.target.value))} className={selectCls}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  on {d}
                </option>
              ))}
            </select>
          </label>
        )}
        {["daily", "weekdays", "weekly"].includes(preset) && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={selectCls} />
          </label>
        )}
        {preset === "custom" && startedCustom && customInput}
      </div>
      {!startedCustom && <MoreOptions about="a custom schedule">{customInput}</MoreOptions>}
      {cron && <p className="text-xs text-muted">{`${describeCron(cron)}, in ${TZ}`}</p>}
    </div>
  );
}
