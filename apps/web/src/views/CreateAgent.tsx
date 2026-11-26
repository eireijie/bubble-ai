import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bot, Check, ChevronRight, Cloud, Download, Laptop, Loader2, Lock, Monitor, Plus, Search, UserPlus, X } from "lucide-react";
import { randomAppearance, type GhostAppearance } from "@bubble-ai/core/src/appearance.ts";
import { Ghost } from "../components/Ghost.tsx";
import { HarnessLogo } from "../components/HarnessLogo.tsx";
import { ConnectionInstructions } from "../components/ConnectionInstructions.tsx";
import { prettyModel } from "../components/EffortSlider.tsx";
import { HARNESSES, accountsSignedIn, preferSignedIn, runsInVm, type Agent, type AgentSignIn, type Connector, type DiscoveredAgent, type Skill } from "@bubble-ai/core";
import { HarnessSignInButton } from "../components/HarnessSignInButton.tsx";
import { api } from "../api.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { go } from "../router.ts";
import { openDm } from "../openDm.ts";
import type { NodeInfo } from "./AgentSettings.tsx";
import { computerKindLabel, usableDevices } from "../devices.ts";
import { defaultComputer, resolveComputer, vmOnDevice, withComputer, type ComputerChoice } from "../agentComputer.ts";
import { MoreOptions } from "../components/MoreOptions.tsx";
import { useFeature } from "../features.ts";
import { useComputerMode } from "../computerMode.ts";
import { LookEditorScreen } from "./LookEditor.tsx";
import { Button, Field, harnessLabel, Input, Modal, Pill, Textarea, cx } from "../components/ui.tsx";

export function ComputerPicker({
  value,
  onChange,
  node,
  nodes,
}: {
  value: ComputerChoice;
  onChange: (c: ComputerChoice) => void;
  node: NodeInfo | undefined;
  nodes: NodeInfo[];
}) {
  const computers = useStore((s) => s.computers);
  const agents = useStore((s) => s.agents);
  const screenExists = computers.some(
    (c) => c.kind === "device" && c.nodeId === node?.id,
  );
  const opt = (
    c: ComputerChoice,
    icon: React.ReactNode,
    title: string,
    body: string,
    disabled?: boolean,
  ) => {
    const selected =
      value.kind === c.kind &&
      (c.kind !== "existing" ||
        (value.kind === "existing" && value.id === c.id));
    return (
      <button
        type="button"
        key={c.kind === "existing" ? c.id : c.kind}
        disabled={disabled}
        onClick={() => onChange(c)}
        className={cx(
          "rounded-xl border p-2.5 text-left flex gap-2.5 disabled:opacity-45 disabled:pointer-events-none",
          selected
            ? "border-accent bg-accent-soft"
            : "border-line hover:bg-hover",
        )}
      >
        <span className="size-7 shrink-0 rounded-lg bg-chip grid place-items-center text-muted">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium truncate">{title}</span>
          <span className="block text-[11px] text-muted leading-tight">
            {body}
          </span>
        </span>
      </button>
    );
  };
  return (
    <div>
      <div className="text-sm font-medium mb-2">Where should it work?</div>
      <div className="grid sm:grid-cols-2 gap-2">
        {node &&
          opt(
            { kind: "vm" },
            <Monitor size={15} />,
            `Its own desktop on ${node.name}`,
            node.capabilities?.vm.ok
              ? "It opens apps and websites there. Your screen stays yours."
              : (node.capabilities?.vm.detail ?? "Connect the device to check"),
            !node.capabilities?.vm.ok,
          )}
        {node?.mine &&
          !screenExists &&
          opt(
            { kind: "screen" },
            <Lock size={15} />,
            "My own screen",
            node.capabilities?.screen.off
              ? `Off. Turn it on at ${node.name}: bubble-ai node screen on`
              : node.capabilities?.screen.ok === false
                ? node.capabilities.screen.detail
                : "It runs on this computer.",
            node.capabilities?.screen.ok !== true,
          )}
        {computers.map((c) =>
          opt(
            { kind: "existing", id: c.id },
            c.kind === "orgo" ? (
              <Cloud size={15} />
            ) : c.kind === "vm" ? (
              <Monitor size={15} />
            ) : (
              <Laptop size={15} />
            ),
            c.name,
            `${computerKindLabel(c, nodes)}${
              c.agents.length
                ? `, shared with ${agents
                    .filter((a) => c.agents.includes(a.id))
                    .map((a) => "@" + a.handle)
                    .join(", ")}`
                : ""
            }`,
          ),
        )}
        {/* the device's job left it without a desktop; the switch for that is under More options, so show the choice here */}
        {value.kind === "headless" &&
          opt({ kind: "headless" }, <Bot size={15} />, "No desktop (answers only)", "It can chat and use files, but can't open apps or websites.")}
        {opt(
          { kind: "later" },
          <Plus size={15} />,
          "Decide later",
          "You can pick on its Computer tab.",
        )}
      </div>
      <MoreOptions className="mt-2">
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={value.kind === "headless"}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? { kind: "headless" }
                  : withComputer(defaultComputer(node, computers)),
              )
            }
          />
          Run it headless: no computer, so no apps or websites
        </label>
      </MoreOptions>
    </div>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 32);

type HarnessChoice = { id: string; label: string; blurb?: string; account?: string; signup?: string; protocol?: string };

/** ACP harnesses can't use HTTP MCP connectors (Gmail etc.); native ones can. */
export const canUseConnectedApps = (h: { id: string; protocol?: string }) => h.protocol !== "acp" && !h.id.startsWith("acp:");

function HarnessGrid({ list, harness, onPick, label }: { list: HarnessChoice[]; harness: string; onPick: (id: string) => void; label: string }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
      {list.map((h) => (
        <button
          type="button"
          key={h.id}
          aria-pressed={harness === h.id}
          onClick={() => onPick(h.id)}
          className={cx("agent-harness-card", harness === h.id && "selected")}
        >
          {harness === h.id && <Check size={14} className="agent-harness-check" />}
          <HarnessLogo harness={h.id} size={24} />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{h.label}</span>
            {h.blurb && <span className="block text-xs text-muted">{h.blurb}</span>}
            {h.account && <span className="block text-xs text-muted">{h.account}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** What "Use my defaults" means, from GET /api/settings/agent-defaults. */
export interface AgentDefaults {
  harness: string | null;
  model: string | null;
  computer: "shared" | "own-vm" | "none";
  nodeId: string | null;
}

/** "Use my defaults" can't create an agent until the defaults name an AI: then you pick one right in the form. */
export const defaultsNeedPicking = (d: AgentDefaults | "error" | null) => d === "error" || (d !== null && !d.harness);

type View = "form" | "look" | "external" | "discover" | "invitation";
type RespondTo = "me" | "anyone" | "people";

/** "Claude Code · Sonnet 5.5" and "Its own computer on my-mac": the defaults in a line each. */
export function defaultsSummary(d: AgentDefaults, nodes: Pick<NodeInfo, "id" | "name">[], simple = false): { ai: string; computer: string } {
  const harness = d.harness ? (harnessLabel(d.harness) ?? d.harness) : "Not picked yet";
  const node = nodes.find((n) => n.id === d.nodeId);
  return {
    ai: `${harness} · ${d.model ? prettyModel(d.model) : "Automatic model"}`,
    computer: simple || d.computer === "shared" ? "The shared computer" : d.computer === "own-vm" ? (node ? `Its own computer on ${node.name}` : "Its own computer") : "No computer",
  };
}

/** Names a new agent is offered: one is already in the field when the sheet opens. */
export const AGENT_NAMES = ["Nova", "Milo", "Wren", "Otto", "Iris", "Finn", "Luna", "Hugo", "Remy", "Sage", "Piper", "Echo", "Maple", "Quill", "Pixel", "Clover", "Indigo", "Ziggy", "Juniper", "Atlas"];

type Named = Pick<Agent, "name" | "handle">;

/** A name none of the agents here has yet, picked at random; numbered ("Nova 2") once every one is used. */
export function suggestName(agents: Named[], random: () => number = Math.random): string {
  const used = new Set(agents.flatMap((a) => [a.handle, slug(a.name)]));
  const pick = <T,>(list: T[]) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const free = AGENT_NAMES.filter((n) => !used.has(slug(n)));
  if (free.length) return pick(free);
  const base = pick(AGENT_NAMES);
  for (let i = 2; ; i++) if (!used.has(slug(`${base} ${i}`))) return `${base} ${i}`;
}

/** The handle a name gets when nobody typed one: its slug, numbered when that's taken ("nova", then "nova-2"); "agent" for a name with no letter a to z. */
export function autoHandle(name: string, taken: string[]): string {
  const base = slug(name) || "agent";
  let h = base;
  for (let i = 2; taken.includes(h); i++) h = `${base.slice(0, 28).replace(/-+$/, "")}-${i}`;
  return h;
}

/**
 * What stops this agent being made, as one short line; null when nothing does. A handle typed by
 * hand is checked as typed. Without one a free handle is picked silently, so only a name another
 * agent already has is a problem.
 */
export function nameProblem(name: string, typedHandle: string, agents: Named[]): string | null {
  const clean = name.trim();
  if (!clean) return null;
  if (typedHandle) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(typedHandle)) return "A handle starts with a letter.";
    return agents.some((a) => a.handle === typedHandle) ? `@${typedHandle} is taken.` : null;
  }
  return agents.some((a) => a.name.trim().toLowerCase() === clean.toLowerCase()) ? `${clean} is already here.` : null;
}

const LABEL = "block text-[13px] font-medium text-muted";
const QUIET = "h-9 px-2.5 rounded-[8px] text-[13px] text-muted hover:text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-50 disabled:pointer-events-none";
const SEG = "flex rounded-xl bg-chip p-0.5";
const SELECT = "h-10 w-full rounded-xl border border-input bg-panel px-2.5 text-sm";
const CHOICE = "flex h-[46px] w-full items-center gap-3 px-3.5 text-left text-[14px] hover:bg-hover outline-none focus-visible:bg-hover";

/**
 * New agent: one small sheet. Its ghost (click it for another look), its name with one suggested
 * already, and Create; it uses your defaults and opens its chat, where it says hello and asks for
 * the rest. "More options" unfolds everything else in the same sheet: what it does, instructions,
 * which AI and computer, handle, who it answers, apps and skills, the look editor, and bringing in
 * an agent that already runs somewhere. "Make it a team" opens the new-team flow instead.
 */
/** `onCreated`: hand the new agent back (to a team being built, say) instead of opening its page. `nodeId`: start on this device. */
export function CreateAgent({ nodes, onClose, onCreated, nodeId: startOn, bringIn }: { nodes: NodeInfo[]; onClose: () => void; onCreated?: (agent: Agent) => void; nodeId?: string; bringIn?: boolean }) {
  const refreshAgents = useStore((s) => s.refreshAgents);
  const agents = useStore((s) => s.agents);
  const computers = useStore((s) => s.computers);
  const me = useStore((s) => s.me);
  const people = useStore((s) => s.members);
  const inviteOn = useFeature("invite");
  const [view, setView] = useState<View>(bringIn ? "external" : "form");
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    body?.scrollTo({ top: 0 });
    const first = body?.querySelector<HTMLElement>("input") ?? body?.querySelector<HTMLElement>("h1");
    first?.focus();
    // the suggested name is selected, so typing replaces it
    if (view === "form") (first as Partial<HTMLInputElement> | undefined)?.select?.();
  }, [view]);

  // who it is
  const [name, setName] = useState(() => suggestName(agents));
  // only what was typed under More options; without it a free handle follows the name
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  // every new agent gets a look of its own, picked once (typing its name doesn't change it)
  const [appearance, setAppearance] = useState<GhostAppearance>(randomAppearance);

  // which AI and computer
  const [defaults, setDefaults] = useState<AgentDefaults | null | "error">(null);
  // a device picked already (its page's "Add an agent here") overrides the default device
  const [mode, setMode] = useState<"defaults" | "custom">(startOn ? "custom" : "defaults");
  const [harness, setHarness] = useState("claude-code");
  const [model, setModel] = useState("");
  const usable = usableDevices(nodes);
  const [nodeId, setNodeId] = useState((startOn && usable.some((n) => n.id === startOn) ? startOn : null) ?? usable.find((n) => n.online)?.id ?? usable[0]?.id ?? "");
  const [computer, setComputer] = useState<ComputerChoice>(() => defaultComputer(nodes.find((n) => n.id === nodeId), computers));
  const createdVm = useRef<{ id: string; nodeId: string } | null>(null);
  const [invite, setInvite] = useState(false);
  const touched = useRef(false);
  // devices can arrive after the dialog opened with none: settle on one then
  const firstUsable = usable.find((n) => n.online)?.id ?? usable[0]?.id;
  useEffect(() => {
    if (nodeId || !firstUsable) return;
    setNodeId(firstUsable);
    setComputer(defaultComputer(nodes.find((n) => n.id === firstUsable), computers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstUsable]);
  useEffect(() => {
    let live = true;
    // no default AI to use: start on one that's signed in on its device (the pick is under More options)
    const startSignedIn = () => {
      const on = nodes.find((n) => n.id === nodeId);
      const pick = preferSignedIn((on?.harnesses ?? []).map((h) => h.id), (id) => accountsSignedIn(on?.harnesses?.find((h) => h.id === id)?.accounts));
      if (pick && !touched.current) setHarness(pick);
    };
    api<AgentDefaults>("GET", "/api/settings/agent-defaults").then(
      (d) => {
        if (!live) return;
        setDefaults(d);
        if (defaultsNeedPicking(d)) {
          setMode("custom");
          startSignedIn();
        }
        // Customize starts from the defaults, unless you already changed something
        if (touched.current) return;
        if (d.harness) setHarness(d.harness);
        if (d.model) setModel(d.model);
        if (d.nodeId && !startOn && usable.some((n) => n.id === d.nodeId)) {
          setNodeId(d.nodeId);
          setComputer(d.computer === "none" ? { kind: "headless" } : defaultComputer(nodes.find((n) => n.id === d.nodeId), computers));
        }
      },
      () => {
        if (!live) return;
        // an older hub has no defaults: pick here instead
        setDefaults("error");
        setMode("custom");
        startSignedIn();
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chooseComputer = (choice: ComputerChoice) => {
    touched.current = true;
    setComputer(choice);
    if (choice.kind === "existing") {
      const c = computers.find((c) => c.id === choice.id);
      if (c?.kind === "vm" && c.nodeId && usable.some((n) => n.id === c.nodeId)) setNodeId(c.nodeId);
    }
  };

  // More options: everything past the name
  const [advanced, setAdvanced] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (advanced) optionsRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [advanced]);
  const [respondTo, setRespondTo] = useState<RespondTo>("me");
  const [respondPeople, setRespondPeople] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [pickedApps, setPickedApps] = useState<string[]>([]);
  const [pickedSkills, setPickedSkills] = useState<string[]>([]);
  useEffect(() => {
    if (!advanced || connectors) return;
    api<Connector[]>("GET", "/api/connectors").then(setConnectors, () => setConnectors([]));
    api<Skill[]>("GET", "/api/skills").then(setSkills, () => setSkills([]));
  }, [advanced, connectors]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Agent | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const node = nodes.find((n) => n.id === nodeId);
  const installed = new Set((node?.harnesses ?? []).map((h) => h.id));
  const declared = [...new Map(usable.flatMap((n) => (n.harnesses ?? []).filter((h) => h.id.startsWith("acp:")).map((h) => [h.id, h] as const))).values()];
  const harnesses = [
    ...HARNESSES.filter((h) => h.id !== "custom"),
    ...declared.map((h) => ({ id: h.id, label: h.id.slice(4), protocol: "acp" as const, note: "Available on a connected device", binary: "" })),
    HARNESSES.find((h) => h.id === "custom")!,
  ];
  // Simple (the default): Bubble AI places it, so only the AI is a choice here; Advanced picks where it runs too
  const { advanced: pickWhere } = useComputerMode();
  const simple = !pickWhere && defaults !== "error";
  const useDefaults = (mode === "defaults" || simple) && !invite && defaults !== null && defaults !== "error";
  const effectiveHarness = mode === "defaults" && useDefaults ? ((defaults as AgentDefaults).harness ?? harness) : harness;
  const selectedHarness = harnesses.find((h) => h.id === effectiveHarness) ?? harnesses[0];
  const external = invite || selectedHarness.protocol === "mcp";
  // the AI picked is known not to be signed in on its device: say so, with Sign in, before it's made
  const signedInOn = (id: string) => accountsSignedIn(node?.harnesses?.find((h) => h.id === id)?.accounts);
  const signInFirst: AgentSignIn | null = node?.mine && !external && signedInOn(selectedHarness.id) === false ? { harness: selectedHarness.id, where: node.name, nodeId: node.id, computerId: null, account: "default" } : null;
  const noneSignedIn = !!signInFirst && !(node?.harnesses ?? []).some((h) => accountsSignedIn(h.accounts) !== false);

  const cleanName = name.trim();
  const typedHandle = slug(handle);
  const finalHandle = typedHandle || autoHandle(cleanName, agents.map((a) => a.handle));
  const look = appearance;
  // one short line under the field it is about
  const problem = nameProblem(cleanName, typedHandle, agents);
  const validName = !!cleanName && !problem;

  const others = people.filter((p) => p.id !== me?.user.id);
  const togglePick = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const finish = () => {
    if (created && onCreated) return onCreated(created);
    onClose();
    if (created) go({ view: "agents", agentId: created.id, tab: "connect" });
  };
  // a team instead: the same flow the sidebar's plus opens
  const makeTeam = () => {
    onClose();
    useStore.setState({ channelBrowser: { sectionId: null, create: true } });
  };
  const startInvite = () => {
    setInvite(true);
    // which harness it joins from is picked under More options
    setAdvanced(true);
    setView("form");
  };

  const submit = async () => {
    if ((!created && !validName) || busy) return;
    setBusy(true);
    setError(null);
    try {
      let a = created;
      if (!a) {
        const settings = {
          appearance,
          ...(role.trim() ? { role: role.trim().slice(0, 60) } : {}),
          ...(inviteOn ? { respondTo, ...(respondTo === "people" ? { respondPeople } : {}) } : {}),
        };
        const common = { name: cleanName, handle: finalHandle, instructions };
        if (useDefaults) {
          // Customize in Simple: the AI picked here, the rest placed by Bubble AI
          const ai = mode === "custom" && !external ? { harness, ...(model.trim() ? { model: model.trim() } : {}) } : {};
          a = await api<Agent>("POST", "/api/agents", { ...common, ...ai, useDefaults: true, settings });
        } else {
          const computerId = external ? null : await resolveComputer(computer, nodeId, cleanName);
          // Keep a newly created computer selected if creating the agent needs a retry.
          if (computerId && (computer.kind === "vm" || computer.kind === "screen")) setComputer({ kind: "existing", id: computerId });
          if (computerId && computer.kind === "vm") createdVm.current = { id: computerId, nodeId };
          const vmHere = vmOnDevice(computer, nodeId, computers) || (createdVm.current?.id === computerId && createdVm.current?.nodeId === nodeId);
          a = await api<Agent>("POST", "/api/agents", {
            ...common,
            harness,
            ...(model.trim() && !external ? { model: model.trim() } : {}),
            nodeId: external ? null : nodeId || null,
            computerId,
            settings: {
              ...settings,
              ...(!external && computer.kind === "headless" ? { headless: true } : {}),
              ...(!external && vmHere && runsInVm(harness) ? { runIn: "computer" as const } : {}),
            },
          });
        }
        setCreated(a);
        // apps and skills picked under More options; ones on for all agents already include it
        const agentId = a.id;
        await Promise.all([
          ...pickedApps.flatMap((id) => {
            const c = connectors?.find((x) => x.id === id);
            return c && !c.allAgents ? [api("PUT", `/api/connectors/${id}/agents/${agentId}`).catch(() => {})] : [];
          }),
          ...pickedSkills.flatMap((id) => (skills?.find((x) => x.id === id)?.allAgents ? [] : [api("PUT", `/api/skills/${id}/agents/${agentId}`).catch(() => {})])),
        ]);
      }
      await Promise.all([refreshAgents(), useStore.getState().refreshComputers()]);
      if (external) {
        const r = await api<{ token: string }>("POST", `/api/agents/${a.id}/token`);
        setToken(r.token);
        setError(null);
        setView("invitation");
      } else if (onCreated) {
        onCreated(a);
      } else {
        onClose();
        // straight to its chat, where it has already said hello
        await openDm(a.id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const summary = defaults && defaults !== "error" ? defaultsSummary(defaults, nodes, simple) : null;
  const failed = error ? `${error}${created ? " Your agent was created. Retry to finish its invitation." : ""}` : null;
  // the line under the name: what is wrong when something is, else the one thing to know
  const handleProblem = problem && typedHandle && advanced ? problem : null;
  const underName = handleProblem ? null : (problem ?? (advanced ? null : failed));
  const width = view === "look" ? "sm:max-w-[920px]!" : view === "external" || (view === "form" && !advanced) ? "sm:max-w-[420px]!" : "sm:max-w-[560px]!";

  return (
    <Modal title="New agent" label="New agent" onClose={busy ? () => {} : onClose} headerless className={cx("sm:rounded-[18px]! transition-[max-width] duration-300 ease-[cubic-bezier(.165,.84,.44,1)] motion-reduce:transition-none", width)} contentClassName="p-0!">
      <div ref={bodyRef}>
        {view === "form" && (
          <form
            className="relative flex flex-col items-center px-6 sm:px-8 pt-9 pb-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <button type="button" onClick={onClose} disabled={busy} className="circle circle-sm absolute right-3 top-3 border-0! bg-chip text-muted hover:text-ink" aria-label="Close">
              <X size={16} />
            </button>
            {/* its ghost: a click gives it another look */}
            <button type="button" disabled={busy || !!created} onClick={() => setAppearance(randomAppearance())} aria-label="Change its look" className="rounded-[20px] outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none">
              <Ghost look={look} size={132} trackPointer label="" />
            </button>

            <fieldset disabled={busy || !!created} className="w-full min-w-0">
              <input
                aria-label="Name"
                placeholder="Name"
                maxLength={80}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                className="w-full bg-transparent pt-2.5 pb-0.5 text-center text-[28px] leading-9 font-[650] outline-none placeholder:text-faint border-b border-transparent focus-visible:border-line2"
              />
              {underName ? (
                <p role="alert" className="pt-1.5 pb-[18px] text-center text-sm text-bad">
                  {underName}
                </p>
              ) : (
                <p className="pt-1.5 pb-[18px] text-center text-sm text-muted">{external ? "It joins with an invitation." : "It says hello and sets itself up in the chat."}</p>
              )}

              {advanced && (
                <div ref={optionsRef} className="space-y-4 pb-5 text-left">
                  <label className="block space-y-1.5">
                    <span className={LABEL}>What it does</span>
                    <Input maxLength={60} value={role} onChange={(e) => setRole(e.target.value)} aria-label="What it does" className="h-10!" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className={LABEL}>Instructions</span>
                    <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} aria-label="Instructions" />
                  </label>

                  {invite ? (
                    <div className="space-y-1.5">
                      <span className={LABEL}>Joins from</span>
                      <HarnessGrid list={harnesses} harness={harness} onPick={setHarness} label="Agent harness" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className={LABEL}>AI and computer</span>
                        {defaults !== "error" && (
                          <div className={SEG} role="radiogroup" aria-label="AI and computer">
                            {(
                              [
                                ["defaults", "Use my defaults"],
                                ["custom", "Customize"],
                              ] as const
                            ).map(([m, label]) => (
                              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cx("h-8 px-3.5 rounded-[10px] text-[13px] font-medium", mode === m ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink")}>
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {mode === "defaults" && defaults !== "error" ? (
                        <div className="rounded-[12px] bg-card px-3.5 py-1.5 text-[14px]">
                          <div className="flex h-9 items-center gap-3">
                            <span className="shrink-0 font-medium">AI</span>
                            <span className="min-w-0 flex-1 flex items-center justify-end gap-1.5 text-[13px] text-muted">
                              {defaults?.harness && <HarnessLogo harness={defaults.harness} size={15} />}
                              <span className="truncate">{summary ? summary.ai : "Loading…"}</span>
                            </span>
                          </div>
                          <div className="flex h-9 items-center gap-3">
                            <span className="shrink-0 font-medium">Computer</span>
                            <span className="min-w-0 flex-1 truncate text-right text-[13px] text-muted">{summary ? summary.computer : "Loading…"}</span>
                          </div>
                          <div className="flex h-9 items-center justify-end">
                            <a href="#/settings/agent-defaults" onClick={onClose} className="text-[13px] text-muted hover:text-ink underline underline-offset-2">
                              Change defaults
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="grid sm:grid-cols-2 gap-3">
                            <label className="space-y-1.5">
                              <span className={LABEL}>Runs on</span>
                              <select
                                value={harness}
                                onChange={(e) => {
                                  touched.current = true;
                                  setHarness(e.target.value);
                                }}
                                className={SELECT}
                              >
                                {harnesses.map((h) => (
                                  <option key={h.id} value={h.id}>
                                    {h.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1.5">
                              <span className={LABEL}>Model</span>
                              <Input
                                value={model}
                                onChange={(e) => {
                                  touched.current = true;
                                  setModel(e.target.value);
                                }}
                                placeholder="Automatic"
                                list="new-agent-models"
                                className="h-10!"
                              />
                              <datalist id="new-agent-models">{defaults && defaults !== "error" && defaults.model && <option value={defaults.model} />}</datalist>
                            </label>
                            {/* only ask which device when there's a real choice, and only in Advanced */}
                            {simple ? null : usable.length < 2 ? (
                              <div className="space-y-1.5">
                                <span className={LABEL}>Device</span>
                                <div className="h-10 flex items-center text-sm">{usable[0] ? `${usable[0].name}${usable[0].online ? "" : " (offline)"}` : "None yet. Connect one under Devices."}</div>
                              </div>
                            ) : (
                              <label className="space-y-1.5">
                                <span className={LABEL}>Device</span>
                                <select
                                  value={nodeId}
                                  onChange={(e) => {
                                    touched.current = true;
                                    setNodeId(e.target.value);
                                    setComputer(defaultComputer(nodes.find((n) => n.id === e.target.value), computers));
                                  }}
                                  className={SELECT}
                                >
                                  <option value="">Decide later</option>
                                  {usable.map((n) => (
                                    <option key={n.id} value={n.id}>
                                      {n.name} ({n.online ? "online" : "offline"})
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </div>
                          {selectedHarness.protocol !== "mcp" && !simple && <ComputerPicker value={computer} onChange={chooseComputer} node={node} nodes={nodes} />}
                          {!simple && node && !runsInVm(harness) && !installed.has(harness) && selectedHarness.protocol !== "mcp" && (
                            <p className="text-xs text-muted">
                              Install {selectedHarness.label} on {node.name} first.
                            </p>
                          )}
                          {!simple && node && !node.online && (
                            <p role="status" className="text-xs text-warn">
                              {node.name} is offline. It answers once {node.name} reconnects.
                            </p>
                          )}
                        </div>
                      )}
                      {signInFirst && (
                        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] bg-card px-3.5 py-2.5 text-[13px]">
                          <span className="min-w-0 flex-1">{noneSignedIn ? `No AI is signed in on ${signInFirst.where} yet.` : `${harnessLabel(signInFirst.harness)} isn't signed in on ${signInFirst.where}.`}</span>
                          <HarnessSignInButton signIn={signInFirst} />
                        </div>
                      )}
                    </div>
                  )}

                  <label className="block space-y-1.5">
                    <span className={LABEL}>Handle</span>
                    <Input
                      value={handle}
                      // loose while typing (a dash can be followed by more); the handle used is its tidy form
                      onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 32))}
                      placeholder={finalHandle}
                      aria-label="Handle"
                      aria-invalid={!!handleProblem}
                      className="h-10!"
                    />
                    {handleProblem && (
                      <span role="alert" className="block text-xs text-bad">
                        {handleProblem}
                      </span>
                    )}
                  </label>
                  {inviteOn && (
                    <div className="space-y-1.5">
                      <span className={LABEL}>Answers</span>
                      <div className={SEG} role="radiogroup" aria-label="Who it answers">
                        {(
                          [
                            ["me", "Only me"],
                            ["anyone", "Anyone"],
                            ["people", "Picked people"],
                          ] as const
                        ).map(([v, label]) => (
                          <button key={v} type="button" role="radio" aria-checked={respondTo === v} onClick={() => setRespondTo(v)} className={cx("flex-1 h-8 px-2 rounded-[10px] text-[13px] font-medium whitespace-nowrap", respondTo === v ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink")}>
                            {label}
                          </button>
                        ))}
                      </div>
                      {respondTo === "people" &&
                        (others.length ? (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {others.map((p) => (
                              <Chip key={p.id} small on={respondPeople.includes(p.id)} onClick={() => setRespondPeople(togglePick(respondPeople, p.id))}>
                                {p.name}
                              </Chip>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted">Nobody else is here yet.</p>
                        ))}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <span className={LABEL}>Apps</span>
                    <div className="flex flex-wrap gap-1.5">
                      {connectors === null && <span className="text-xs text-muted">Loading…</span>}
                      {connectors?.map((c) =>
                        c.allAgents ? (
                          <span key={c.id} className="h-8 px-2.5 rounded-lg bg-chip text-[13px] font-medium inline-flex items-center gap-1" title="On for all agents">
                            <Check size={13} /> {c.name}
                          </span>
                        ) : (
                          <Chip key={c.id} small on={pickedApps.includes(c.id)} onClick={() => setPickedApps(togglePick(pickedApps, c.id))}>
                            {c.name}
                          </Chip>
                        ),
                      )}
                      <AddChip onClick={() => (onClose(), go({ view: "connectors" }))} />
                    </div>
                    {!canUseConnectedApps(selectedHarness) && <p className="text-xs text-muted">{selectedHarness.label} can't use apps yet.</p>}
                  </div>
                  <div className="space-y-1.5">
                    <span className={LABEL}>Skills</span>
                    <div className="flex flex-wrap gap-1.5">
                      {skills === null && <span className="text-xs text-muted">Loading…</span>}
                      {skills?.map((sk) =>
                        sk.allAgents ? (
                          <span key={sk.id} className="h-8 px-2.5 rounded-lg bg-chip text-[13px] font-medium inline-flex items-center gap-1" title="On for all agents">
                            <Check size={13} /> {sk.name}
                          </span>
                        ) : (
                          <Chip key={sk.id} small on={pickedSkills.includes(sk.id)} onClick={() => setPickedSkills(togglePick(pickedSkills, sk.id))} title={sk.description}>
                            {sk.name}
                          </Chip>
                        ),
                      )}
                      <AddChip onClick={() => (onClose(), go({ view: "skills" }))} />
                    </div>
                  </div>
                  <div className="-mx-2.5 flex flex-wrap gap-x-2">
                    <button type="button" className={QUIET} onClick={() => setView("look")}>
                      Edit look
                    </button>
                    {!invite && (
                      <button type="button" className={QUIET} onClick={() => setView("external")}>
                        Bring one in
                      </button>
                    )}
                  </div>
                </div>
              )}
            </fieldset>

            {advanced && failed && (
              <p role="alert" className="w-full pb-3 text-center text-sm text-bad">
                {failed}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={busy || (!created && (!validName || (mode === "defaults" && !invite && defaults === null)))} className="w-full h-11! text-[15px]">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {external ? "Create invitation" : "Create"}
            </Button>
            <div className="flex flex-wrap justify-center gap-x-2 pt-2">
              <button type="button" className={QUIET} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
                {advanced ? "Fewer options" : "More options"}
              </button>
              {invite ? (
                <button type="button" className={QUIET} disabled={busy || !!created} onClick={() => setInvite(false)}>
                  New agent instead
                </button>
              ) : (
                !onCreated && (
                  <button type="button" className={QUIET} disabled={busy || !!created} onClick={makeTeam}>
                    Make it a team
                  </button>
                )
              )}
            </div>
          </form>
        )}

        {view === "look" && (
          <div className="p-5 sm:p-7">
            <LookEditorScreen
              initial={look}
              name={cleanName}
              saveLabel="Use this look"
              onBack={() => setView("form")}
              onSave={(l) => {
                setAppearance(l);
                setView("form");
              }}
            />
          </div>
        )}

        {view === "external" && (
          <div className="p-5 sm:p-6 space-y-4">
            <BackHeader title="Bring one in" onBack={() => setView("form")} />
            <div className="rounded-[12px] bg-card overflow-hidden">
              <button type="button" onClick={startInvite} className={CHOICE}>
                <UserPlus size={17} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">Invite an agent</span>
                <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />
              </button>
              <button type="button" onClick={() => setView("discover")} className={CHOICE}>
                <Search size={17} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">Find on a device</span>
                <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />
              </button>
            </div>
          </div>
        )}

        {view === "discover" && (
          <div className="p-5 sm:p-6 space-y-4">
            <BackHeader title="Find an agent" onBack={() => setView("external")} />
            <ImportAgent nodes={nodes} onClose={onClose} onInvite={startInvite} />
          </div>
        )}

        {view === "invitation" && token && (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-3.5">
              <Ghost look={look} size={56} trackPointer />
              <h1 tabIndex={-1} className="min-w-0 text-[19px] font-semibold leading-[26px] outline-none">
                Invite {cleanName} to Bubble AI
              </h1>
            </div>
            <ConnectionInstructions token={token} harness={harness} />
            <div className="flex justify-end gap-2">
              {!onCreated && (
                <Button type="button" variant="ghost" onClick={finish}>
                  Close
                </Button>
              )}
              <Button type="button" variant="primary" onClick={finish}>
                {onCreated ? "Back to team" : "Open agent"} <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Chip({ on, onClick, children, title, small }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string; small?: boolean }) {
  return (
    <button type="button" role={small ? undefined : "radio"} aria-checked={small ? undefined : on} aria-pressed={small ? on : undefined} onClick={onClick} title={title} className={cx("rounded-[8px] border font-medium transition-colors", small ? "h-8 px-2.5 text-[13px] rounded-lg" : "h-8 px-3.5 text-[13px]", on ? "bg-ink text-bg border-ink" : "bg-panel text-ink border-line hover:bg-hover")}>
      {children}
    </button>
  );
}

function AddChip({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="h-8 px-2.5 rounded-lg border border-dashed border-line text-[13px] font-medium text-muted hover:text-ink inline-flex items-center gap-1">
      <Plus size={13} /> Add
    </button>
  );
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} className="circle circle-sm border-0! bg-chip text-muted hover:text-ink" aria-label="Back">
        <ArrowLeft size={16} />
      </button>
      <h1 tabIndex={-1} className="min-w-0 truncate text-[17px] font-semibold leading-6 outline-none">
        {title}
      </h1>
    </div>
  );
}

/** Agents that already live on a device (Hermes, OpenClaw, Claude Code subagents): bring them in with their soul and notes. */
/** A free handle from a name: "Claude Code (your setup)" → "claude", or "claude-2" when that's taken. */
export function freeHandle(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^[^a-z]+/, "")
      .split("-")[0]
      .slice(0, 28) || "agent";
  let h = base;
  for (let i = 2; taken.includes(h); i++) h = `${base}-${i}`;
  return h;
}

/**
 * Bring in an agent found on a device. Claude Code, Codex, Hermes and Kimi CLI move into a VM on that device when
 * it has one (their instructions and memories come along); others keep running on the device.
 */
export async function importFound(
  x: { node: NodeInfo; d: DiscoveredAgent },
  o: {
    handle: string;
    computerId: string | null;
    headless?: boolean;
    computers: ComputerInfo[];
  },
): Promise<Agent> {
  const vmHere = o.computers.some(
    (c) => c.id === o.computerId && c.kind === "vm" && c.nodeId === x.node.id,
  );
  return api<Agent>("POST", "/api/agents/import", {
    nodeId: x.node.id,
    key: x.d.key,
    handle: o.handle,
    computerId: o.computerId,
    headless: !!o.headless,
    ...(vmHere && runsInVm(x.d.harness) ? { runIn: "computer" } : {}),
  });
}

export function ImportAgent({
  nodes: initialNodes,
  onClose,
  onInvite,
}: {
  nodes: NodeInfo[];
  onClose: () => void;
  onInvite: () => void;
}) {
  const [nodes, setNodes] = useState(initialNodes);
  const [scanning, setScanning] = useState(false);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (scanTimer.current) clearTimeout(scanTimer.current);
    },
    [],
  );
  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      await Promise.all(
        usableDevices(nodes)
          .filter((n) => n.online)
          .map((n) => api("POST", `/api/nodes/${n.id}/discover`)),
      );
      const refresh = async (remaining: number) => {
        try {
          setNodes(await api<NodeInfo[]>("GET", "/api/nodes"));
        } catch (err) {
          setError((err as Error).message);
          setScanning(false);
          return;
        }
        if (remaining > 0)
          scanTimer.current = setTimeout(
            () => void refresh(remaining - 1),
            1000,
          );
        else setScanning(false);
      };
      await refresh(3);
    } catch (err) {
      setError((err as Error).message);
      setScanning(false);
    }
  };
  const refreshAgents = useStore((s) => s.refreshAgents);
  const agents = useStore((s) => s.agents);
  const computers = useStore((s) => s.computers);
  const found = useMemo(
    () =>
      usableDevices(nodes).flatMap((n) =>
        (n.discovered ?? []).map((d) => ({ node: n, d })),
      ),
    [nodes],
  );
  const [pick, setPick] = useState<{
    node: NodeInfo;
    d: DiscoveredAgent;
  } | null>(null);
  const [handle, setHandle] = useState("");
  const [computer, setComputer] = useState<ComputerChoice>({ kind: "later" });
  const imported = useRef(new Map<string, Agent>());
  const importComputers = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^[^a-z]+/, "")
      .replace(/-+$/, "")
      .slice(0, 32);

  const choose = (x: { node: NodeInfo; d: DiscoveredAgent }) => {
    setPick(x);
    setHandle(
      freeHandle(
        x.d.name,
        agents.map((a) => a.handle),
      ),
    );
    const existing = importComputers.current.get(`${x.node.id}:${x.d.key}`);
    setComputer(existing ? { kind: "existing", id: existing } : defaultComputer(x.node, computers));
  };

  if (!found.length)
    return (
      <div className="rounded-[12px] bg-card p-4 space-y-3 text-sm">
        <p className="font-medium">No saved setups found yet</p>
        <p className="text-muted">
          {usableDevices(nodes).some((n) => n.online) ? "Bubble AI checks known folders on your connected devices." : "Connect a device first."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={onInvite}>
            <UserPlus size={16} />
            Invite instead
          </Button>
          <Button
            type="button"
            disabled={scanning || !usableDevices(nodes).some((n) => n.online)}
            onClick={() => void scan()}
          >
            {scanning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Search size={16} />
            )}
            {scanning ? "Looking…" : "Look again"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
      </div>
    );

  const fresh = found.filter(
    (x) =>
      !imported.current.has(`${x.node.id}:${x.d.key}`) &&
      !agents.some(
        (a) =>
          a.nodeId === x.node.id &&
          a.harness === x.d.harness &&
          a.name === x.d.name,
      ),
  );
  const bringAll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const taken = [...agents, ...imported.current.values()].map((a) => a.handle);
    try {
      for (const x of fresh) {
        const handle = freeHandle(x.d.name, taken);
        taken.push(handle);
        const c = defaultComputer(x.node, computers);
        const key = `${x.node.id}:${x.d.key}`;
        const computerId = importComputers.current.get(key) ?? await resolveComputer(c, x.node.id, x.d.name);
        if (computerId) importComputers.current.set(key, computerId);
        const all = c.kind === "vm" ? await api<ComputerInfo[]>("GET", "/api/computers") : computers;
        const a = await importFound(x, {
          handle,
          computerId,
          headless: c.kind === "headless",
          computers: all,
        });
        imported.current.set(key, a);
      }
      await Promise.all([
        refreshAgents(),
        useStore.getState().refreshComputers(),
      ]);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" disabled={scanning} onClick={() => void scan()}>
          {scanning ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Search size={15} />
          )}
          Look again
        </Button>
      </div>
      {error && !pick && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {fresh.length > 0 && (fresh.length > 1 || imported.current.size > 0) && !pick && (
        <div className="flex items-center gap-3 rounded-[12px] bg-card px-3.5 py-2.5 text-sm">
          <span className="flex-1">{fresh.length} agents found</span>
          <Button variant="primary" disabled={busy} onClick={bringAll}>
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}{" "}
            Bring in all
          </Button>
        </div>
      )}
      <div className="rounded-[12px] bg-card overflow-hidden">
        {found.map((x) => {
          const taken = imported.current.has(`${x.node.id}:${x.d.key}`) || agents.some(
            (a) =>
              a.nodeId === x.node.id &&
              a.harness === x.d.harness &&
              a.name === x.d.name,
          );
          return (
            <button
              key={`${x.node.id}:${x.d.key}`}
              disabled={busy || taken}
              onClick={() => choose(x)}
              className={cx(
                "w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-hover",
                pick?.d.key === x.d.key &&
                  pick.node.id === x.node.id &&
                  "bg-accent-soft",
              )}
            >
              <HarnessLogo harness={x.d.harness} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">
                  {x.d.name}{" "}
                  <span className="font-normal text-muted">
                    · {harnessLabel(x.d.harness)} on {x.node.name}
                  </span>
                </span>
                <span className="block text-xs text-muted truncate">
                  {[
                    x.d.description,
                    x.d.hasSoul && "has a personality",
                    x.d.memoryCount
                      ? `${x.d.memoryCount} note${x.d.memoryCount === 1 ? "" : "s"}`
                      : null,
                    x.d.model,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {taken && <Pill>already here</Pill>}
            </button>
          );
        })}
      </div>
      {pick && (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError(null);
            try {
              const key = `${pick.node.id}:${pick.d.key}`;
              const computerId = await resolveComputer(
                computer,
                pick.node.id,
                pick.d.name,
              );
              if (computerId && (computer.kind === "vm" || computer.kind === "screen")) {
                importComputers.current.set(key, computerId);
                setComputer({ kind: "existing", id: computerId });
              }
              const all =
                computer.kind === "vm" || (computer.kind === "existing" && !computers.some((c) => c.id === computerId))
                  ? await api<ComputerInfo[]>("GET", "/api/computers")
                  : computers;
              const a = await importFound(pick, {
                handle,
                computerId,
                headless: computer.kind === "headless",
                computers: all,
              });
              imported.current.set(key, a);
              await Promise.all([
                refreshAgents(),
                useStore.getState().refreshComputers(),
              ]);
              onClose();
              await openDm(a.id);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Handle"
            hint={pick.d.path}
          >
            <Input
              value={handle}
              onChange={(e) => setHandle(slug(e.target.value))}
              required
            />
          </Field>
          <ComputerPicker
            value={computer}
            onChange={setComputer}
            node={pick.node}
            nodes={nodes}
          />
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy}>
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}{" "}
              Bring in {pick.d.name}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
