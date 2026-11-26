import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Camera, ChevronLeft, ChevronRight, ClipboardList, Cloud, FolderOpen, Keyboard, Laptop, Loader2, Monitor, MoreHorizontal, Server, Upload, Video, X } from "lucide-react";
import { type Agent, type PageElement } from "@bubble-ai/core";
import { api, uploadFile } from "../api.ts";
import { useStore, type ComputerInfo } from "../store.ts";
import { go, href } from "../router.ts";
import { useFeature } from "../features.ts";
import { isTopOverlay, useOverlay } from "../overlays.ts";
import { osName, usableDevices, vmAvailabilityNote, type DeviceInfo } from "../devices.ts";
import { ComputersHome, toneText, useNodes, useTileStatus } from "./ComputersParts.tsx";
import { ComputerSheet } from "./DevicePage.tsx";
import { LiveScreen, ScreenThumb, WorkingBadge, type LiveScreenHandle, type ScreenInput } from "../components/Screen.tsx";
import { ClipboardPanel, FilesPanel, remotePlatform, saveScreenshot, sendFiles, useClipboardSync } from "../components/ComputerSync.tsx";
import { AgentAvatar, Button, Field, Input, Menu, Modal, Pill, Textarea, cx } from "../components/ui.tsx";

export { computerState, useComputerState, KIND_ICON, stateColor, activityDot } from "./computerState.ts";
import { useComputerState, stateColor, isWatchHash, sheetTarget, watchHref } from "./computerState.ts";

const onHash = (on: () => void) => {
  window.addEventListener("hashchange", on);
  window.addEventListener("popstate", on);
  return () => {
    window.removeEventListener("hashchange", on);
    window.removeEventListener("popstate", on);
  };
};

/** Is the address a computer's live view? It is the computer's own address with /watch after it, which the router reads as the same route, so this reads the address itself. */
function useWatching(): boolean {
  return isWatchHash(useSyncExternalStore(onHash, () => location.hash, () => ""));
}

/**
 * Computers: one page of tiles. #/computers/<id> and #/computers/d/<nodeId> open that computer's
 * sheet beside the grid; #/computers/<id>/watch (and teaching a task) is its live view, which
 * gets the whole area.
 */
export function ComputersView({ computerId, teach, deviceId }: { computerId: string | null; teach: string | null; deviceId?: string | null }) {
  const computers = useStore((s) => s.computers);
  const me = useStore((s) => s.me);
  const [nodes, refreshNodes] = useNodes();
  const watching = useWatching();
  const selected = computers.find((c) => c.id === computerId);

  const [computersChecked, setComputersChecked] = useState(false);
  useEffect(() => {
    if (me?.role !== "guest") void Promise.resolve(useStore.getState().refreshComputers()).finally(() => setComputersChecked(true));
  }, [me?.role]);

  if (me?.role === "guest") return null;

  if (selected && (teach || watching)) return <ComputerLive key={selected.id} computer={selected} devices={nodes} teach={teach} />;

  const target = sheetTarget({ computerId, deviceId }, nodes, computers, computersChecked);
  return (
    <ComputersHome nodes={nodes} open={target?.key}>
      {target && <ComputerSheet key={target.key} target={target} refresh={refreshNodes} />}
    </ComputersHome>
  );
}

// --- adding a computer ------------------------------------------------------------------------------

type Kind = "vm" | "device" | "orgo";

/** New VMs are medium unless someone changes the size. */
export const DEFAULT_SIZE = "medium" as const;

const SIZES = { small: { cpus: 1, memoryGb: 2, ram: 4, cpu: 1 }, medium: { cpus: 2, memoryGb: 4, ram: 8, cpu: 2 }, large: { cpus: 4, memoryGb: 8, ram: 16, cpu: 4 } };
const SIZE_LABEL = { small: "Small", medium: "Medium", large: "Large" };

/** Whether the Orgo cloud option can be used yet: it needs an API key saved in Settings → Computers. */
export function orgoStatus(orgo: { configured: boolean } | null): "checking" | "needs-key" | "ready" {
  return orgo === null ? "checking" : orgo.configured ? "ready" : "needs-key";
}

/** What the dialog starts on: a cloud computer when that is all it offers, else the agent's own desktop when a device can run one. */
export function startKind(only: "here" | "cloud" | undefined, usable: DeviceInfo[]): Kind | null {
  if (only === "cloud") return "orgo";
  return usable.some((d) => d.capabilities?.vm.ok) ? "vm" : null;
}

/**
 * Make a computer for agents: its own desktop (a VM on one of your devices), your own screen, or
 * a cloud computer. Where it lives, its name and its size are filled in; Change opens them.
 * `only` narrows it to what the Add list's row was: this computer, or a cloud computer.
 */
export function AddComputer({ devices, onClose, onCreated, nodeId: preferNode, defaultName, only }: { devices: DeviceInfo[]; onClose: () => void; onCreated: (c: ComputerInfo) => void; nodeId?: string | null; defaultName?: string; only?: "here" | "cloud" }) {
  const usable = usableDevices(devices);
  const [picked, setPicked] = useState<Kind | null>(null);
  const kind = picked ?? startKind(only, usable);
  const [pickedNode, setPickedNode] = useState<string | null>(null);
  const [name, setName] = useState(defaultName ?? "");
  const [size, setSize] = useState<"small" | "medium" | "large">(DEFAULT_SIZE);
  const [orgo, setOrgo] = useState<{ configured: boolean } | null>(null);
  const [existing, setExisting] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ orgo: { configured: boolean } }>("GET", "/api/settings/computers").then((s) => setOrgo(s.orgo), () => setOrgo({ configured: false }));
  }, []);
  const mineOnly = devices.filter((d) => d.mine);
  // "your own screen" is only ever one of your devices
  const choices = kind === "device" ? mineOnly : usable;
  const has = (id: string | null | undefined) => !!id && choices.some((d) => d.id === id);
  const nodeId = has(pickedNode) ? pickedNode! : has(preferNode) ? preferNode! : ((kind === "vm" ? choices.find((d) => d.online && d.capabilities?.vm.ok) : undefined) ?? choices.find((d) => d.online) ?? choices[0])?.id ?? "";
  const device = choices.find((d) => d.id === nodeId);
  const orgoState = orgoStatus(orgo);
  const fallbackName = kind === "vm" ? `${device?.name ?? "VM"} desktop` : kind === "orgo" ? "Cloud computer" : (device?.name ?? "");

  const create = async () => {
    if (kind === "orgo" && orgoState !== "ready") return;
    setBusy(true);
    setError(null);
    try {
      const s = SIZES[size];
      const body =
        kind === "device"
          ? { kind, nodeId, name: name || undefined }
          : kind === "vm"
            ? { kind, nodeId, name: name || fallbackName, cpus: s.cpus, memoryGb: s.memoryGb }
            : { kind, name: name || fallbackName, ...(existing.trim() ? { computerId: existing.trim() } : { ram: s.ram, cpu: s.cpu }) };
      const c = await api<ComputerInfo>("POST", "/api/computers", body);
      await useStore.getState().refreshComputers();
      onCreated(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const option = (k: Kind, icon: ReactNode, title: string, note?: string, disabled?: boolean) => (
    <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={disabled} onClick={() => setPicked(k)} className={cx("flex min-h-[51px] w-full items-center gap-3 rounded-[14px] border px-3.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60", kind === k ? "border-ink bg-card" : cx("border-line", !disabled && "hover:bg-hover"))}>
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{title}</span>
        {note && <span className="block text-xs text-warn">{note}</span>}
      </span>
    </button>
  );

  // what stands in the way, only when something does
  const caps = kind && kind !== "orgo" ? device?.capabilities : undefined;
  const problem = !caps ? null : kind === "vm" ? (caps.vm.ok ? null : caps.vm.detail) : caps.screen.off ? `${device!.name}'s screen is off. Turn it on at that computer.` : caps.screen.ok ? null : caps.screen.detail;
  const sized = (kind === "vm" || kind === "orgo") && !existing.trim();
  const summary = !kind ? null : kind === "orgo" ? [name || fallbackName, existing.trim() ? "One you have" : SIZE_LABEL[size], "Orgo"].join(" · ") : device ? [kind === "vm" ? name || fallbackName : null, kind === "vm" ? SIZE_LABEL[size] : null, `On ${device.name}`].filter(Boolean).join(" · ") : null;

  return (
    <Modal title={only === "cloud" ? "A cloud computer" : only === "here" ? "This computer" : "Add a computer"} onClose={onClose}>
      <div className="space-y-4">
        {only !== "cloud" && (
          <div role="radiogroup" aria-label="What to add" className="space-y-2">
            {option("vm", <Monitor size={18} strokeWidth={1.8} />, "Its own desktop", vmAvailabilityNote(usable))}
            {mineOnly.length > 0 && option("device", <Laptop size={18} strokeWidth={1.8} />, "My screen")}
            {!only && option("orgo", <Cloud size={18} strokeWidth={1.8} />, "A cloud computer", orgoState === "checking" ? "Checking…" : undefined, orgoState !== "ready")}
          </div>
        )}
        {only === "cloud" && orgoState === "checking" && <p className="text-sm text-muted">Checking…</p>}
        {only !== "here" && orgoState === "needs-key" && (
          <p className="text-sm text-warn">
            Add your Orgo API key first.{" "}
            <a href={href({ view: "settings", page: "devices" })} onClick={onClose} className="underline text-accent-text">
              Open settings
            </a>
          </p>
        )}
        {problem && <p className="text-xs text-bad">{problem}</p>}
        {summary && !changing && (
          <p className="text-[13px] text-muted">
            {summary}{" "}
            <button type="button" onClick={() => setChanging(true)} className="font-medium text-ink underline underline-offset-2">
              Change
            </button>
          </p>
        )}
        {kind && changing && (
          <div className="grid sm:grid-cols-2 gap-3">
            {kind !== "orgo" && choices.length > 1 && (
              <Field label="On">
                <select value={nodeId} onChange={(e) => setPickedNode(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-panel px-2 text-sm">
                  {choices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({osName(d.capabilities?.platform)}, {d.online ? "online" : "offline"})
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={fallbackName} />
            </Field>
            {sized && (
              <Field label="Size">
                <select value={size} onChange={(e) => setSize(e.target.value as typeof size)} className="h-9 w-full rounded-lg border border-line bg-panel px-2 text-sm">
                  <option value="small">Small: 1 CPU, {kind === "vm" ? "2" : "4"} GB</option>
                  <option value="medium">Medium: 2 CPUs, {kind === "vm" ? "4" : "8"} GB</option>
                  <option value="large">Large: 4 CPUs, {kind === "vm" ? "8" : "16"} GB</option>
                </select>
              </Field>
            )}
            {kind === "orgo" && (
              <Field label="One you have in Orgo">
                <Input value={existing} onChange={(e) => setExisting(e.target.value)} placeholder="Its ID" />
              </Field>
            )}
          </div>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!kind || busy || (kind !== "orgo" && !nodeId) || (kind === "orgo" && orgoState !== "ready")} onClick={create}>
            {busy && <Loader2 size={15} className="animate-spin" />} Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// --- one computer, live ---------------------------------------------------------------------------------

/**
 * A computer's live view: the screen gets the whole area. One slim row above it: Back, the
 * computer's name, what the agent is doing, Take over or Hand back, and one "…" for Clipboard,
 * Files, Keys, Screenshot and Teach a task. Phones and desktops share it.
 */
export function ComputerLive({ computer: c, devices, teach }: { computer: ComputerInfo; devices: DeviceInfo[] | null; teach: string | null }) {
  const me = useStore((s) => s.me)!;
  const agents = useStore((s) => s.agents);
  const state = useComputerState(c);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teachOn = useFeature("teach");
  const [pickTeach, setPickTeach] = useState(false);
  const [panel, setPanel] = useState<"files" | "clipboard" | null>(null);
  const [dropping, setDropping] = useState(false);
  const [filesChanged, setFilesChanged] = useState(0);
  const screen = useRef<LiveScreenHandle>(null);
  const touched = useRef(0);
  const mine = c.controller?.id === me.user.id;
  const canEdit = me.role !== "guest";
  const device = devices?.find((d) => d.id === c.nodeId);
  const on = agents.filter((a) => c.agents.includes(a.id));
  const teacher = teach ? agents.find((a) => a.id === teach) : undefined;
  // a device and its own screen are one computer: it goes by the device's name
  const own = c.kind === "device" ? device : undefined;
  const name = own?.name ?? c.name;
  const status = useTileStatus({ kind: c.kind === "orgo" ? "cloud" : c.kind, device: own, computer: c });

  const control = async (take: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/computers/${c.id}/control`, { take });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // leaving the desk gives the computer back, so agents aren't stuck waiting on a closed view
  useEffect(() => () => {
    const current = useStore.getState().computers.find((computer) => computer.id === c.id);
    if (current?.controller?.id === me.user.id) void api("POST", `/api/computers/${c.id}/control`, { take: false }).catch(() => {});
  }, [c.id, me.user.id]);

  // teaching needs control
  useEffect(() => {
    if (teacher && c.online && !c.controller) control(true);
  }, [teacher?.id, c.online]);

  const canControl = canEdit && c.online && !c.paused;
  // moving files and clipboard text doesn't need control, only a computer that's there
  const canTransfer = canEdit && c.online && !c.paused;
  const platform = remotePlatform(c, devices);
  const sync = useClipboardSync(c, mine && !teacher, platform);
  const toggle = (p: NonNullable<typeof panel>) => setPanel((cur) => (cur === p ? null : p));
  const dropOnScreen = async (files: File[]) => {
    sync.flash(files.length === 1 ? `Sending ${files[0].name}…` : `Sending ${files.length} files…`);
    try {
      await sendFiles(c.id, "~/Desktop", files);
      sync.flash(files.length === 1 ? `Sent ${files[0].name} to the Desktop` : `Sent ${files.length} files to the Desktop`);
      setFilesChanged((n) => n + 1);
    } catch (e) {
      sync.flash((e as Error).message);
    }
  };
  const lead = status.agent ?? on[0];
  const [keys, setKeys] = useState(false);
  const [typed, setTyped] = useState("");
  const act = (action: object) => api("POST", `/api/computers/${c.id}/act`, { action }).catch((e) => setError((e as Error).message));

  // one status line, worded like the tile's, with what the agent is doing or asking for
  const statusColor = stateColor(state, c, mine);
  const statusText = mine ? "You're in control" : c.help && status.tone === "warn" ? `${status.text}: ${c.help.request}` : status.working && c.activity?.text ? `${status.text} · ${c.activity.text}` : status.text;

  // the agent a task is taught to: the one on this computer, else the only one there is, else a pick
  const teachTo = on[0] ?? (agents.length === 1 ? agents[0] : undefined);
  const startTeach = () => (teachTo ? go({ view: "computers", computerId: c.id, teach: teachTo.id }) : setPickTeach(true));
  const tools = [
    ...(canTransfer ? [{ label: "Clipboard", icon: <ClipboardList size={16} />, onSelect: () => toggle("clipboard") }, { label: "Files", icon: <FolderOpen size={16} />, onSelect: () => toggle("files") }] : []),
    ...(mine ? [{ label: "Keys", icon: <Keyboard size={16} />, onSelect: () => setKeys((k) => !k) }] : []),
    ...(c.online && !c.paused ? [{ label: "Screenshot", icon: <Camera size={16} />, onSelect: () => void saveScreenshot(c).catch((e) => setError(e.message)) }] : []),
    ...(teachOn && canControl && agents.length > 0 ? [{ label: "Teach a task", icon: <Video size={16} />, onSelect: startTeach }] : []),
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col safe-top safe-bottom">
      {teacher ? (
        <TeachBar agent={teacher} computer={c} screen={screen} />
      ) : (
        <div className="flex h-12 shrink-0 items-center gap-2 px-2 md:px-3" data-testid="screen-bar">
          <a href={own ? href({ view: "computers", computerId: null, deviceId: own.id }) : href({ view: "computers", computerId: c.id })} className="circle circle-sm" aria-label="Back">
            <ChevronLeft size={18} />
          </a>
          {lead && <AgentAvatar agent={lead} size={24} live />}
          <div className="min-w-0 flex-1 md:flex md:items-baseline md:gap-2.5" data-testid="name-chip">
            <h1 className="truncate text-[14px] font-semibold leading-5 md:max-w-[16rem] md:shrink-0" title={name}>
              {name}
            </h1>
            <p role="status" className={cx("truncate text-[13px] leading-5 md:min-w-0 md:flex-1", status.working && !mine ? "m-wait text-ink" : !(mine || c.help) && toneText(status.tone))} style={mine || c.help ? { color: statusColor } : undefined} title={statusText}>
              {statusText}
            </p>
          </div>
          {canControl &&
            (mine ? (
              <Button variant="primary" className="h-8! shrink-0" disabled={busy} onClick={() => void control(false)}>
                Hand back
              </Button>
            ) : (
              <Button variant="primary" className="h-8! shrink-0" disabled={busy || !!c.controller} onClick={() => void control(true)}>
                Take over
              </Button>
            ))}
          {tools.length > 0 && (
            <Menu
              align="right"
              items={tools}
              trigger={(open, t) => (
                <button type="button" data-overlay-ignore onClick={t} aria-expanded={open} aria-haspopup="menu" className={cx("circle circle-sm", open && "bg-hover")} aria-label="More">
                  <MoreHorizontal size={18} />
                </button>
              )}
            />
          )}
        </div>
      )}

      {error && <p className="shrink-0 mx-3 mb-2 text-sm text-bad">{error}</p>}
      {c.status === "error" && c.statusText && <p className="shrink-0 mx-3 mb-2 text-sm text-bad">{c.statusText}</p>}

      {/* the panels and Keys sit beside the screen (not inside its keyboard capture), so local copy and paste in them stays local */}
      <div className="relative flex-1 min-h-0 overflow-hidden bg-black">
        <div
          className="absolute inset-0"
          onKeyDownCapture={sync.onKeyDownCapture}
          onDragOver={(e) => {
            if (!canTransfer || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
          onDrop={(e) => {
            setDropping(false);
            if (!canTransfer || !e.dataTransfer.files.length) return;
            e.preventDefault();
            void dropOnScreen([...e.dataTransfer.files]);
          }}
        >
          <LiveScreen
            ref={screen}
            computer={c}
            control={mine}
            noRing
            compact
            onInput={teacher ? (i) => screen.current && teachSink.current?.(i) : undefined}
            onTakeControl={canControl && !c.controller && !teacher ? () => void control(true) : undefined}
            onActivity={() => {
              // VNC input skips the hub, so say now and then that you're still using it
              if (Date.now() - touched.current < 15_000) return;
              touched.current = Date.now();
              void api("POST", `/api/computers/${c.id}/control`, { take: true }).catch(() => {});
            }}
          />

          {/* the amber frame says the desk is yours */}
          {mine && <div className="absolute inset-0 z-10 border-2 border-st-needs pointer-events-none" data-testid="control-frame" />}

          {dropping && (
            <div className="absolute inset-0 z-30 border-2 border-dashed border-info bg-info/15 grid place-items-center pointer-events-none">
              <span className="inline-flex items-center gap-2 rounded-full bg-black/70 text-white px-4 h-10 text-sm font-medium">
                <Upload size={16} /> Drop to send
              </span>
            </div>
          )}
        </div>

        {sync.note && (
          <span className="absolute left-1/2 top-2 z-20 max-w-[90%] -translate-x-1/2 truncate rounded-full bg-black/70 px-3 py-1 text-xs text-white pointer-events-none" role="status">
            {sync.note}
          </span>
        )}

        {panel && (
          <FloatingPanel
            label={panel === "files" ? "Files" : "Clipboard"}
            onClose={() => setPanel(null)}
            className="m-panel fixed inset-x-0 bottom-0 top-auto max-h-[70vh] z-40 md:absolute md:inset-x-auto md:right-3 md:top-3 md:bottom-auto md:w-80 md:max-h-[calc(100%-1.5rem)] overflow-y-auto text-sm bg-panel text-ink border border-line rounded-t-[16px] md:rounded-xl p-4 shadow-panel safe-bottom"
            testId="float-panel"
          >
            {panel === "files" ? <FilesPanel computer={c} onClose={() => setPanel(null)} refresh={filesChanged} onSent={sync.flash} /> : <ClipboardPanel computer={c} mine={mine} platform={platform} onClose={() => setPanel(null)} />}
          </FloatingPanel>
        )}
      </div>

      {mine && keys && !teacher && (
        <FloatingPanel
          label="Keys"
          onClose={() => setKeys(false)}
          as="form"
          className="shrink-0 p-2 flex flex-col gap-2 w-full m-menu"
          onSubmit={(e) => {
            e.preventDefault();
            if (!typed) return;
            void act({ action: "type", text: typed });
            setTyped("");
          }}
        >
          <div className="flex items-center gap-2">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type on computer" aria-label="Type on computer" className="flex-1 min-w-0" />
            <Button type="submit" disabled={!typed}>
              Send
            </Button>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto [&>button]:shrink-0">
            {[["Return", "Enter"], ["Tab", "Tab"], ["Escape", "Escape"], ["Delete", "Backspace"]].map(([label, key]) => (
              <Button key={label} type="button" onClick={() => void act({ action: "key", keys: key })}>
                {label}
              </Button>
            ))}
          </div>
        </FloatingPanel>
      )}

      {pickTeach && (
        <Modal title="Who should learn it?" onClose={() => setPickTeach(false)}>
          <div className="space-y-1 text-sm">
            {agents.map((a) => (
              <button key={a.id} onClick={() => (setPickTeach(false), go({ view: "computers", computerId: c.id, teach: a.id }))} className="w-full flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-hover text-left">
                <AgentAvatar agent={a} size={28} badge={false} />
                <span className="flex-1">{a.name}</span>
                <ChevronRight size={14} className="text-faint" />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Move focus into an overlay when it opens and back to where it came from when it closes. */
function useFocusScope(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>("input, textarea, select, button, a[href]") ?? el)?.focus({ preventScroll: true });
    return () => {
      if (from && from !== document.body && from.isConnected) from.focus({ preventScroll: true });
    };
  }, []);
}

/**
 * Clipboard, Files and Keys: floating panels over the screen. They sit on the overlay stack, so
 * Escape and a click outside close the top one, and focus moves in and then back. Their buttons
 * (data-overlay-ignore) and menus handle their own clicks.
 */
function FloatingPanel({ label, onClose, as: Tag = "aside", className, testId, children, onSubmit }: { label: string; onClose: () => void; as?: "aside" | "form"; className: string; testId?: string; children: ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  const id = useMemo(() => Symbol(`computer-${label}`), [label]);
  const ref = useRef<HTMLElement>(null);
  useOverlay(id, "modal");
  useFocusScope(ref);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!isTopOverlay(id)) return;
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest?.("[data-overlay-ignore], [role=menu], [role=dialog]")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !isTopOverlay(id)) return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [id]);
  const props = { ref: ref as never, tabIndex: -1, "aria-label": label, className: cx(className, "outline-none"), "data-testid": testId, onSubmit };
  return Tag === "form" ? <form {...props}>{children}</form> : <aside {...props}>{children}</aside>;
}

/** The teach bar writes steps here; module-level so LiveScreen's callback stays stable. */
const teachSink: { current: ((i: ScreenInput) => void) | null } = { current: null };

interface Step extends ScreenInput {
  at: number;
  snapshot?: string;
}

const MAX_SNAPSHOTS = 40;

/**
 * "Nova is watching and learning ● 0:04": records what you do, then hands it to the agent, which
 * saves it as a skill; you land in your chat with it to see that. It takes the live view's top row
 * while it records. While saving skills is off (Settings → Skills) it says so instead of recording.
 */
function TeachBar({ agent, computer, screen }: { agent: Agent; computer: ComputerInfo; screen: React.RefObject<LiveScreenHandle | null> }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [steps, setSteps] = useState<Step[]>([]);
  const [narration, setNarration] = useState("");
  const [saving, setSaving] = useState<null | "naming" | "uploading">(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // null until known; teaching ends in a skill, so it waits for skills to be allowed
  const [skillsOff, setSkillsOff] = useState<boolean | null>(null);
  const shots = useRef(0);

  useEffect(() => {
    api<{ learnSkills?: boolean }>("GET", "/api/settings/agents").then(
      (p) => setSkillsOff(p.learnSkills === false),
      () => setSkillsOff(false),
    );
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (skillsOff !== false) return;
    teachSink.current = (i) => {
      const wantShot = ["click", "double_click", "right_click", "drag"].includes(i.kind) || (i.kind === "key" && i.keys === "Enter");
      const snapshot = wantShot && shots.current < MAX_SNAPSHOTS ? (screen.current?.snapshot() ?? undefined) : undefined;
      if (snapshot) shots.current++;
      const at = Date.now() - start;
      setSteps((s) => [...s, { ...i, at, snapshot }]);
      // on a VM, also note which page element it was, so the routine survives layout changes
      if (computer.kind === "vm" && i.x !== undefined && i.y !== undefined && ["click", "double_click", "right_click"].includes(i.kind)) {
        api<{ element: PageElement | null }>("POST", `/api/computers/${computer.id}/act`, { action: { action: "inspect", x: i.x, y: i.y } }).then(
          (r) => r.element && setSteps((s) => s.map((x) => (x.at === at ? { ...x, element: r.element! } : x))),
          () => {},
        );
      }
    };
    return () => {
      teachSink.current = null;
    };
  }, [start, screen, computer.id, computer.kind, skillsOff]);

  const elapsed = Math.floor((now - start) / 1000);
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  const finish = async () => {
    setSaving("uploading");
    setError(null);
    try {
      const out = [];
      for (const s of steps) {
        let imageFileId: string | undefined;
        if (s.snapshot) {
          const blob = await (await fetch(s.snapshot)).blob();
          imageFileId = (await uploadFile(new File([blob], `step-${out.length + 1}.jpg`, { type: "image/jpeg" }))).id;
        }
        const { snapshot: _s, ...rest } = s;
        out.push({ ...rest, imageFileId });
      }
      const r = await api<{ channelId: string }>("POST", "/api/routines/teach", { agentId: agent.id, name: name.trim(), computerId: computer.id, steps: out, durationMs: Date.now() - start, narration: narration.trim() || undefined });
      await api("POST", `/api/computers/${computer.id}/control`, { take: false }).catch(() => {});
      // the agent saves it as a skill in your chat with it ("Learned: …" under its reply)
      await useStore.getState().refreshChannels();
      go({ view: "chat", channelId: r.channelId, threadId: null });
    } catch (e) {
      setError((e as Error).message);
      setSaving("naming");
    }
  };

  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-1.5" data-testid="teach-bar">
      <AgentAvatar agent={agent} size={24} badge={false} live />
      {skillsOff ? (
        <div className="min-w-0 flex-1 text-[14px] leading-5" data-testid="teach-skills-off">
          <div className="truncate">Saving skills is off</div>
          <a href={href({ view: "settings", page: "skills", item: null })} className="text-[13px] text-muted underline underline-offset-2">
            Turn it on in Settings → Skills to teach {agent.name}
          </a>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] leading-5">
            <span className="font-semibold">{agent.name}</span> is watching and learning
          </div>
          <div className="text-[13px] leading-5 text-muted tabular-nums">
            <span className="mr-1.5 inline-block size-2 rounded-full bg-bad animate-pulse" aria-hidden /> {clock} · {steps.length} step{steps.length === 1 ? "" : "s"}
          </div>
        </div>
      )}
      <Button
        variant="ghost"
        className="h-8!"
        onClick={() => {
          api("POST", `/api/computers/${computer.id}/control`, { take: false }).catch(() => {});
          location.hash = watchHref(computer.id);
        }}
      >
        <X size={15} /> Cancel
      </Button>
      <Button variant="primary" className="h-8!" disabled={!steps.length || !!skillsOff} onClick={() => setSaving("naming")}>
        Done
      </Button>
      {saving && (
        <Modal title="Save as a skill" onClose={() => saving !== "uploading" && setSaving(null)}>
          <div className="space-y-3">
            <Field label="What's the task called?">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly reporting" autoFocus />
            </Field>
            <Field label="Anything else it should know? (optional)">
              <Textarea rows={3} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What changes each time" />
            </Field>
            {error && <p className="text-sm text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={saving === "uploading"} onClick={() => setSaving(null)}>
                Keep recording
              </Button>
              <Button variant="primary" disabled={!name.trim() || saving === "uploading"} onClick={finish}>
                {saving === "uploading" && <Loader2 size={15} className="animate-spin" />} Teach {agent.name}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// in a file of its own, so a chat that shows the card doesn't bring this whole page with it
export { ComputerMini } from "./ComputerMini.tsx";
