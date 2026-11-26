import { useEffect, useState } from "react";
import { HARNESSES } from "@bubble-ai/core";
import { api, ApiError } from "../../api.ts";
import { useStore } from "../../store.ts";
import { usableDevices, useDevices } from "../../devices.ts";
import { Button, Input } from "../../components/ui.tsx";
import { Card, PageHeader, Row, SavedNote, Section, Select, useSavedFlash } from "./parts.tsx";

/** GET/PUT /api/settings/agent-defaults: what "Use my defaults" fills in for a new agent. */
export interface AgentDefaults {
  harness: string | null;
  model: string | null;
  computer: "shared" | "own-vm" | "none";
  nodeId: string | null;
  /** a default model for each AI tool (harness id to model id) */
  models: Record<string, string>;
}

/** Harnesses a new agent can run with on a device (the ones that join from outside aren't picked here). */
const CHOICES = HARNESSES.filter((h) => h.protocol !== "mcp");

/** What new agents start with: loaded once, edited as a draft, saved whole (the hub takes the full set). */
export function useAgentDefaults() {
  const isOwner = useStore((s) => s.me?.role) === "owner";
  const [saved, setSaved] = useState<AgentDefaults | null>(null);
  const [form, setForm] = useState<AgentDefaults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, showFlash] = useSavedFlash();

  useEffect(() => {
    api<AgentDefaults>("GET", "/api/settings/agent-defaults").then(
      (d) => {
        setSaved(d);
        setForm(d);
      },
      (e) => setError(e instanceof ApiError && e.status === 404 ? "This hub doesn't have agent defaults yet. Update it in Settings, About." : (e as Error).message),
    );
  }, []);

  const save = async (draft: AgentDefaults | null = form) => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      // a tool whose box was emptied is sent as null so the hub forgets it
      const models: Record<string, string | null> = {};
      for (const h of CHOICES) {
        const v = draft.models?.[h.id]?.trim() ?? "";
        if (v || saved?.models?.[h.id]) models[h.id] = v || null;
      }
      const next = await api<AgentDefaults>("PUT", "/api/settings/agent-defaults", { ...draft, model: draft.model?.trim() || null, models });
      setSaved(next);
      setForm(next);
      showFlash();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { isOwner, saved, form, setForm, error, busy, flash, save };
}

/** What the New agents think with row says: the tool, or that each agent picks. */
export function thinksValue(d: AgentDefaults | null): string {
  if (!d) return "";
  return d.harness ? (CHOICES.find((h) => h.id === d.harness)?.label ?? d.harness) : "Pick each time";
}

/** New agents think with: the AI tool and model new agents start with, and a model for each tool. */
export function AgentDefaultsPage() {
  const { isOwner, saved, form, setForm, error, busy, flash, save } = useAgentDefaults();
  if (!form) return <PageHeader title="Agent defaults">{error ?? "Loading…"}</PageHeader>;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  return (
    <>
      <Card className="mb-7">
        <Row label="Tool">
          <Select label="Harness" value={form.harness ?? ""} disabled={!isOwner} onChange={(v) => setForm({ ...form, harness: v || null })}>
            <option value="">Pick for each agent</option>
            {CHOICES.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Model">
          <Input className="w-56" value={form.model ?? ""} disabled={!isOwner} placeholder="Default" onChange={(e) => setForm({ ...form, model: e.target.value })} aria-label="Model" />
        </Row>
      </Card>
      <Section title="Model for each tool">
        <Card>
          {CHOICES.map((h) => (
            <Row key={h.id} label={h.label}>
              <Input
                className="w-56"
                value={form.models?.[h.id] ?? ""}
                disabled={!isOwner}
                placeholder="Automatic"
                aria-label={`Default model for ${h.label}`}
                onChange={(e) => setForm({ ...form, models: { ...form.models, [h.id]: e.target.value } })}
              />
            </Row>
          ))}
        </Card>
      </Section>
      {isOwner && (
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <SavedNote shown={flash} />
        </div>
      )}
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}
    </>
  );
}

/** The devices a new agent's computer can be on: the ones that can run a computer when it gets its own. */
export function useDefaultDeviceChoices(computer: AgentDefaults["computer"] | undefined) {
  const devices = useDevices(15_000);
  const mine = devices ? usableDevices(devices) : [];
  const vmDevices = mine.filter((d) => d.capabilities?.vm.ok);
  return { choices: computer === "own-vm" && vmDevices.length ? vmDevices : mine, noneCanRun: computer === "own-vm" && !!devices && !vmDevices.length };
}
