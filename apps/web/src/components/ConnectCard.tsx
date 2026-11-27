import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { ConnectSuggestion, Connector } from "@bubble-ai/core";
import { api } from "../api.ts";
import { connectApps } from "../appSignIn.ts";
import { AppTile } from "./MarketParts.tsx";
import { cx } from "./ui.tsx";

/**
 * The apps an agent suggests connecting (a "connect" message part, hub setup-picks.ts): each with
 * its reason and a one-tap Connect that opens the app's own sign-in page and says when it's done.
 * Composio, always recommended, carries a "Recommended" mark. Nothing here sees a password.
 */

type State = "idle" | "out" | "on" | { error: string };

/** Already connected: signed in, or made with its key. */
export function isConnected(c: Pick<Connector, "catalogId" | "auth">, id: string): boolean {
  return c.catalogId === id && (c.auth ? c.auth.signedIn : true);
}

export function ConnectCard({ apps }: { apps: ConnectSuggestion[] }) {
  const [conn, setConn] = useState<Record<string, State>>({});
  const tries = useRef<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    // anything already connected shows so
    api<Connector[]>("GET", "/api/connectors").then(
      (list) => live && setConn((c) => ({ ...Object.fromEntries(apps.filter((a) => list.some((x) => isConnected(x, a.id))).map((a) => [a.id, "on" as const])), ...c })),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = async (id: string) => {
    const n = (tries.current[id] = (tries.current[id] ?? 0) + 1);
    setConn((c) => ({ ...c, [id]: "out" }));
    const r = await connectApps([id]);
    if (tries.current[id] !== n) return;
    setConn((c) => ({ ...c, [id]: r.ok ? "on" : { error: r.error } }));
  };
  const cancel = (id: string) => {
    tries.current[id] = (tries.current[id] ?? 0) + 1;
    setConn((c) => ({ ...c, [id]: "idle" }));
  };

  if (!apps.length) return null;
  return (
    <div className="mt-1.5 w-full max-w-md overflow-hidden rounded-[14px] bg-card" role="list" aria-label="Apps to connect">
      {apps.map((a, i) => {
        const state = conn[a.id] ?? "idle";
        return (
          <div key={a.id} role="listitem" className={cx("flex min-h-[60px] items-center gap-3 px-3.5 py-2.5", i > 0 && "shadow-[inset_0_1px_0_var(--line)]")}>
            {/* the always-recommended one connects many apps: the same tile as on the Automation shelf */}
            <AppTile name={a.name} category={a.recommended ? "Automation" : undefined} size={34} />
            <span className="min-w-0 flex-1">
              {/* on a phone the mark goes under the name rather than cutting it short */}
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="text-[15px] font-semibold leading-5">{a.name}</span>
                {a.recommended && <span className="shrink-0 rounded-[5px] px-1.5 py-px text-[11px] font-semibold text-wisp shadow-[inset_0_0_0_1px_currentColor]">Recommended</span>}
              </span>
              <span className={cx("block text-[13px] leading-[17px]", typeof state === "object" ? "text-bad" : "text-muted")}>{typeof state === "object" ? state.error : a.why}</span>
            </span>
            {state === "on" ? (
              <span className="flex shrink-0 items-center gap-1 text-[13.5px] font-semibold text-ok">
                <Check size={15} strokeWidth={2.8} aria-hidden />
                Connected
              </span>
            ) : state === "out" ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted" role="status">
                <Loader2 size={14} className="animate-spin" aria-label="Finish signing in in your browser" />
                <button type="button" onClick={() => cancel(a.id)} className="h-8 rounded-lg px-2 text-[13px] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void signIn(a.id)}
                aria-label={`${typeof state === "object" ? "Try again" : "Connect"} ${a.name}`}
                className="h-8 shrink-0 rounded-lg bg-panel px-3 text-[13.5px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--line2)] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {typeof state === "object" ? "Try again" : "Connect"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
