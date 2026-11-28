/** The five places' line icons, drawn as on the round 11 boards (plain strokes, no fills). */
function Line({ d, size = 19, width = 1.8 }: { d: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

export const PLACE_PATHS = {
  chats: "M4 5h16v11H8l-4 4z",
  computers: "M3 4h18v12H3zM8 20h8M12 16v4",
  memory: "M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-7",
  marketplace: "M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0",
  more: "M5 12h.01M12 12h.01M19 12h.01M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0",
} as const;
export type PlaceKey = keyof typeof PLACE_PATHS;

export const PlaceIcon = ({ place, size, width }: { place: PlaceKey; size?: number; width?: number }) => <Line d={PLACE_PATHS[place]} size={size} width={width} />;
export const PlusLine = ({ size = 16 }: { size?: number }) => <Line d="M12 5v14M5 12h14" size={size} width={2} />;
