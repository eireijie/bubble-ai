import { useEffect, useRef } from "react";
import { startBubbles } from "./bubbles.ts";
import "./mark.css";

/** Background bubbles behind onboarding (see bubbles.ts): few, faint, pushed by the main bubble. */
export function BackgroundBubbles({ max = 10 }: { max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? startBubbles(ref.current, { max }) : undefined), [max]);
  return <div ref={ref} className="bgb-layer" style={{ position: "fixed" }} aria-hidden />;
}
