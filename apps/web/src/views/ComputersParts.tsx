import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, Laptop, Plus, Smartphone, X } from "lucide-react";
import { api } from "../api.ts";
import { computerProblem } from "@bubble-ai/core";
import { useStore, type ComputerInfo } from "../store.ts";
import { href } from "../router.ts";
import { AddDeviceDialog, type AddStep } from "../components/AddDevice.tsx";
import { ScreenThumb } from "../components/Screen.tsx";
import { AgentAvatar, Button, agentColor, cx } from "../components/ui.tsx";
import { computerTiles, tileStatus, type ComputerTile, type Tone } from "./computerState.ts";
import type { NodeInfo } from "./deviceBits.tsx";

// --- shared bits ----------------------------------------------------------------------------------

/** The devices, looked up again every few seconds, with a way to look right now (after a change). */
export function useNodes(): [NodeInfo[] | null, () => Promise<void>] {
  const [nodes, setNodes] = useState<NodeInfo[] | null>(null);
  // the same answer as last time keeps the list it already has, so a poll with no news re-renders nothing
  const load = useCallback(() => api<NodeInfo[]>("GET", "/api/nodes").then((d) => setNodes((cur) => (cur && JSON.stringify(cur) === JSON.stringify(d) ? cur : d)), () => {}), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  return [nodes, load];
}

/** Phones that get this person's notifications (the hub knows a count, not names). */
export function usePhones(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    api<{ devices?: number }>("GET", "/api/me/push").then((r) => setN(r.devices ?? 0), () => {});
  }, []);
  return n;
}

/** The one Add flow: the list of what can be added, then that thing's steps. `start(step)` skips the list. */
export function useAddFlow(): { start: (step?: AddStep) => void; element: ReactNode } {
  const [step, setStep] = useState<AddStep | null>(null);
  return { start: (s = "list") => setStep(s), element: step && <AddDeviceDialog start={step} onClose={() => setStep(null)} /> };
}

/** Start a VM or cloud computer (it's off, or it couldn't start): the hub starts it and keeps its status. */
export function startComputer(computerId: string) {
  return api("POST", `/api/computers/${computerId}/start`);
}

/**
 * A VM or cloud computer that couldn't start: why, in plain words, and Try again. The device's
 * own words are under Details.
 */
export function StartProblem({ computer: c, className }: { computer: ComputerInfo; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (c.status !== "error" || c.kind === "device") return null;
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await startComputer(c.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="alert" className={cx("space-y-1 text-[13px]", className)} data-testid="start-problem">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-bad">{computerProblem(c.statusText)}</p>
        <Button className="h-8! shrink-0" disabled={busy} onClick={() => void retry()}>
          Try again
        </Button>
      </div>
      {c.statusText && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">Details</summary>
          <p className="mt-1 break-words">{c.statusText}</p>
        </details>
      )}
      {error && <p className="text-bad">{error}</p>}
    </div>
  );
}

/** The colour of a status line: amber when it waits on you, red for a problem, quiet otherwise. */
export const toneText = (tone: Tone) => (tone === "warn" ? "text-st-needs" : tone === "bad" ? "text-bad" : "text-muted");

/** A tile's status, looked at again as activity ages ("Atlas is working" goes back to "Ready"). */
export function useTileStatus(tile: Pick<ComputerTile, "kind" | "device" | "computer">) {
  const me = useStore((s) => s.me);
  const agents = useStore((s) => s.agents);
  const members = useStore((s) => s.members);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  return tileStatus(tile, agents, me?.user.id, (id) => members.find((m) => m.id === id)?.name ?? "Someone");
}

// --- the page ----------------------------------------------------------------------------------------

/**
 * A computer's picture: its screen (live, or the last frame the hub has), a quiet block when it
 * is asleep or offline, an icon when it has no screen. While an agent works on it, it wears that
 * agent's colour as an outline and the agent's ghost sits in its corner.
 */
export function TilePicture({ tile, status, className, ghost = 22 }: { tile: Pick<ComputerTile, "kind" | "computer">; status: ReturnType<typeof tileStatus>; className?: string; ghost?: number }) {
  const color = status.working && status.agent ? agentColor(status.agent) : undefined;
  return (
    <span className={cx("relative block overflow-hidden rounded-[10px] bg-card", className)} style={color ? { boxShadow: `0 0 0 1.5px ${color}` } : undefined}>
      {tile.computer ? (
        <ScreenThumb computer={tile.computer} quiet className="w-full rounded-none" />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-muted">{tile.kind === "phone" ? <Smartphone size={30} strokeWidth={1.5} /> : <Laptop size={30} strokeWidth={1.5} />}</span>
      )}
      {color && (
        <span className="absolute bottom-1.5 left-2">
          <AgentAvatar agent={status.agent} size={ghost} live interactive={false} />
        </span>
      )}
    </span>
  );
}

/** One computer: its screen, its name, one status line. On phones a quiet one is a row; a working one stays big. */
function Tile({ tile, open }: { tile: ComputerTile; open: boolean }) {
  const status = useTileStatus(tile);
  return (
    <a
      href={tile.to}
      aria-current={open ? "page" : undefined}
      className={cx("flex min-w-0 rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-4 focus-visible:ring-offset-panel", status.working ? "flex-col gap-2" : "items-center gap-3 sm:flex-col sm:items-stretch sm:gap-2")}
    >
      <TilePicture tile={tile} status={status} className={cx("aspect-[16/10] shrink-0 sm:w-full", status.working ? "w-full" : "w-24", open && !status.working && "ring-2 ring-line2")} />
      <span className="min-w-0 flex-1 px-0.5">
        <span className="block truncate text-[15px] font-semibold leading-5">{tile.name}</span>
        <span className={cx("block truncate text-[13px] leading-5", status.working ? "m-wait text-ink" : toneText(status.tone))}>{status.text}</span>
      </span>
    </a>
  );
}

/**
 * Computers: a title, one plus, and one tile per computer (devices, their VMs, cloud computers,
 * paired phones), newest activity first. The open computer's sheet sits beside the grid on
 * desktops and over it on phones.
 */
export function ComputersHome({ nodes, open, children }: { nodes: NodeInfo[] | null; open?: string | null; children?: ReactNode }) {
  const computers = useStore((s) => s.computers);
  const phones = usePhones();
  const add = useAddFlow();
  const tiles = computerTiles(nodes ?? [], computers, phones);
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div data-tour="computers-list" className="mx-auto max-w-[1120px] space-y-5 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-7 md:pt-7">
          <header className="flex items-center gap-3">
            <h1 className="t-title min-w-0 flex-1 truncate">Computers</h1>
            <button type="button" onClick={() => add.start()} aria-label="Add a computer or phone" className="m-press grid h-[34px] w-[35px] shrink-0 place-items-center rounded-full bg-side-active text-ink outline-none hover:bg-line2 focus-visible:ring-2 focus-visible:ring-ring/40 max-md:size-11">
              <Plus size={16} strokeWidth={1.8} />
            </button>
          </header>
          {nodes && tiles.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <p className="text-[14px] text-muted">No computers yet.</p>
              <Button variant="primary" onClick={() => add.start()}>
                Add a computer
              </Button>
            </div>
          ) : (
            <div className={cx("grid gap-x-[18px] gap-y-5 sm:grid-cols-2 sm:gap-y-6", children ? "2xl:grid-cols-3" : "xl:grid-cols-3")}>
              {tiles.map((t) => (
                <Tile key={t.key} tile={t} open={open === t.key} />
              ))}
            </div>
          )}
        </div>
      </div>
      {/* the open computer's sheet: 310 px beside the grid on desktops (it pushes the grid as it opens), the whole screen on phones */}
      {children && (
        <aside aria-label="Computer details" className="m-details fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-panel safe-top lg:relative lg:inset-auto lg:z-auto lg:w-[310px] lg:shrink-0 lg:border-l lg:border-line">
          {/* its own 310 px, so nothing reflows while the sheet opens */}
          <div className="flex min-h-0 flex-1 flex-col lg:w-[310px]">{children}</div>
        </aside>
      )}
      {add.element}
    </div>
  );
}

/** The top of a computer's sheet: its name and Close (Back on phones). `back` is set while one of its rows is open in place. */
export function SheetHead({ title, back }: { title: string; back?: { label: string; onClick: () => void } }) {
  const list = href({ view: "computers", computerId: null });
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-3">
      {back ? (
        <button type="button" onClick={back.onClick} className="circle circle-sm" aria-label={back.label}>
          <ChevronLeft size={18} />
        </button>
      ) : (
        <a href={list} className="circle circle-sm lg:hidden" aria-label="Back to Computers">
          <ChevronLeft size={18} />
        </a>
      )}
      <h2 className={cx("min-w-0 flex-1 truncate font-semibold", back ? "text-center text-[14px]" : "text-[15px] lg:pl-1")}>{title}</h2>
      <a href={list} className="circle circle-sm max-lg:hidden" aria-label="Close">
        <X size={16} />
      </a>
      {/* phones: keeps a centred title centred, with no Close beside it */}
      {back && <span className="w-11 shrink-0 lg:hidden" aria-hidden />}
    </div>
  );
}
