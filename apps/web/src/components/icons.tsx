import { Bubble } from "./Bubble.tsx";
import type { ReactNode } from "react";

/**
 * Bubble AI's own line icons for the four places (Inbox, Chats, Agents, Computers), drawn like the
 * approved design: 24px grid, 1.8 stroke, round caps. Everything else uses lucide.
 */
function Line({ size = 22, children, className }: { size?: number; children: ReactNode; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {children}
    </svg>
  );
}

export const InboxIcon = (p: { size?: number; className?: string }) => (
  <Line {...p}>
    <path d="M3 13l3-8h12l3 8v6H3z" />
    <path d="M3 13h5l1 2h6l1-2h5" />
  </Line>
);

export const ChatsIcon = (p: { size?: number; className?: string }) => (
  <Line {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
  </Line>
);

export const AgentsIcon = (p: { size?: number; className?: string }) => (
  <Line {...p}>
    <path d="M12 2.5a7.5 7.5 0 0 0-7.5 7.5v11l2.5-1.7 2.5 1.7 2.5-1.7 2.5 1.7 2.5-1.7 2.5 1.7V10A7.5 7.5 0 0 0 12 2.5z" />
    <circle cx="9.5" cy="10.5" r="0.6" fill="currentColor" />
    <circle cx="14.5" cy="10.5" r="0.6" fill="currentColor" />
  </Line>
);

export const ComputersIcon = (p: { size?: number; className?: string }) => (
  <Line {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Line>
);

/** Bubble AI's ghost, filled: the mark on the rail's top button. */
export function WispGhost({ size = 34, className }: { size?: number; className?: string }) {
  // Bubble AI's mark: its violet bubble, still (2026-11-25 "Bubble AI, bubbles")
  return <Bubble look={{ color: "#a59bff" }} size={size} animate={false} label="" className={className} />;
}

/** A line icon of a bubble with two eyes: "agents" in Bubble AI's own menus (lucide-sized, stroke). */
export function BubbleIcon({ size = 18, strokeWidth = 1.8, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 10.5v1.5M14.5 10.5v1.5" />
    </svg>
  );
}
