/**
 * The desktop sidebar's width (2026-11-22 "Bubble AI, decluttered"): always docked, dragged wider or
 * narrower by its edge, and it stays where it's left. Below SNAP it snaps to a rail of ghosts.
 * The width and whether it's collapsed are remembered on this device.
 */
export const SIDEBAR = {
  /** the narrow rail (round 11, board 9b): measured in the Mac app, the traffic lights span x 20–80, so 100 leaves 20px either side */
  rail: 100,
  min: 256,
  max: 480,
  /** double-click the edge */
  default: 320,
  /** dragged under this, it snaps to the rail; pulled back past it, it springs to min */
  snap: 168,
  /** arrow keys on the edge */
  step: 16,
  /** windows narrower than this show the rail until there's room again (the saved width is kept) */
  roomy: 960,
} as const;

/** Grok Bot-measured motion: opening settles fast-then-slow, closing is quicker. */
export const SIDEBAR_EASE = "cubic-bezier(.165,.84,.44,1)";
export const SIDEBAR_OPEN_MS = 200;
export const SIDEBAR_CLOSE_MS = 100;

/** "2": the first key held widths chosen around the old 260px default (and was written on every load). */
const KEY = "wisp.sidebar2";

/** Collapse or expand the sidebar from anywhere (search, a shortcut); the sidebar listens for it. */
export const SIDEBAR_TOGGLE = "wisp:sidebar-toggle";
export function toggleSidebar(): void {
  window.dispatchEvent(new Event(SIDEBAR_TOGGLE));
}

export interface SidebarState {
  /** the width it has when it isn't collapsed */
  width: number;
  collapsed: boolean;
}

export function clampWidth(w: number): number {
  if (!Number.isFinite(w)) return SIDEBAR.default;
  return Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, Math.round(w)));
}

/** Where the edge lands while dragging, from the pointer's distance to the sidebar's left edge. */
export function dragWidth(x: number): number {
  return x < SIDEBAR.snap ? SIDEBAR.rail : clampWidth(x);
}

/** After a drag ends at `w`: a full width is kept; the rail collapses and keeps the last full width. */
export function settle(prev: SidebarState, w: number): SidebarState {
  return w <= SIDEBAR.rail ? { width: prev.width, collapsed: true } : { width: clampWidth(w), collapsed: false };
}

/** The arrow keys on the focused edge: 16 px a press, and past the narrowest it collapses. */
export function stepWidth(s: SidebarState, dir: -1 | 1): SidebarState {
  if (s.collapsed) return dir > 0 ? { width: SIDEBAR.min, collapsed: false } : s;
  const next = s.width + dir * SIDEBAR.step;
  if (next < SIDEBAR.min) return { width: s.width, collapsed: true };
  return { width: clampWidth(next), collapsed: false };
}

export function loadSidebar(): SidebarState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SidebarState> | null;
    if (raw && typeof raw === "object") return { width: clampWidth(Number(raw.width ?? SIDEBAR.default)), collapsed: raw.collapsed === true };
  } catch {}
  return { width: SIDEBAR.default, collapsed: false };
}

export function saveSidebar(s: SidebarState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ width: clampWidth(s.width), collapsed: s.collapsed }));
  } catch {}
}
