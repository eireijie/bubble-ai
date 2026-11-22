/** The check that draws itself in (it just shows under Reduce Motion). */
export function DrawnCheck({ size = 16, color = "var(--ok)" }: { size?: number; color?: string }) {
  return (
    <svg className="ob-draw shrink-0" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
