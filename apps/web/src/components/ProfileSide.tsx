import { useEffect, useRef, type ReactNode } from "react";
import { closePopup } from "../router.ts";
import { topOverlay } from "../overlays.ts";
import { escapeCloses } from "./SettingsDialog.tsx";

/**
 * An agent's profile on desktops (board ProfileSide): a glass panel on the right of the chat that
 * pushes the chat narrower. It slides open and shut; Escape closes it when nothing sits on top of
 * it and you aren't typing in the chat. Narrow windows lay it over the chat instead (index.css).
 */
export function ProfileSide({ closing, label, children }: { closing: boolean; label: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (closing) return;
    const key = (e: KeyboardEvent) => {
      if (topOverlay() && topOverlay() !== "help") return;
      if (document.querySelector('[role="menu"], [role="listbox"], [aria-modal="true"]')) return;
      const t = e.target as Node | null;
      // Escape in the chat's message box is the chat's own
      if (t && t !== document.body && !panel.current?.contains(t)) return;
      if (!escapeCloses(e, false)) return;
      e.preventDefault();
      closePopup();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [closing]);
  return (
    <aside ref={panel} aria-label={label} data-closing={closing || undefined} inert={closing} className="profile-side">
      <div className="profile-side-inner lg-glass">{children}</div>
    </aside>
  );
}
