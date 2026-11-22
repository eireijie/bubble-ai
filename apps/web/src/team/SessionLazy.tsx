import { Suspense, type ComponentProps } from "react";
import { lazyView } from "../lazy.tsx";
import type { TeamEditSession as Session } from "./Session.tsx";

// The team builder (canvas, step forms, templates, the new-agent pages) is only needed once someone
// opens it: a file of its own, fetched in the background after the app is up (lazy.tsx).
const Lazy = lazyView(() => import("./Session.tsx").then((m) => m.TeamEditSession));

/** `TeamEditSession` for the places that are always loaded (a chat, a team's info and settings). */
export function TeamEditSession(props: ComponentProps<typeof Session>) {
  return (
    <Suspense fallback={null}>
      <Lazy {...props} />
    </Suspense>
  );
}
