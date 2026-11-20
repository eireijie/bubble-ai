import { useEffect, useState, type ReactNode } from "react";
import { Apple, Bell, CircleDot, Clock, Ghost, HardDrive, ListChecks, MonitorSmartphone, SquareTerminal, UserPlus } from "lucide-react";
import { FEATURE_INFO, FEATURE_KEYS, UNLISTED_FEATURES, type FeatureKey, type Features } from "@wisp/core";
import { useStore } from "../../store.ts";
import { setFeatures, useFeatures } from "../../features.ts";
import { AskAgent } from "../../components/AskAgent.tsx";
import { Button, cx } from "../../components/ui.tsx";
import { go, type Route } from "../../router.ts";

/** Where each mod shows up once it is on: a short place name for the toast, and the page to open (none when it lives outside the app window). */
export const MOD_HOME: Record<FeatureKey, { place: string; to: Route | null }> = {
  background: { place: "the Inbox, and each agent's Background tab", to: { view: "dashboard" } },
  routines: { place: "each agent's Routines tab", to: { view: "agents", agentId: null } },
  teach: { place: "an agent's page, under Teach", to: { view: "agents", agentId: null } },
  tasks: { place: "Tasks", to: { view: "tasks" } },
  buddy: { place: "a small ghost on your desktop", to: null },
  invite: { place: "Settings, People", to: { view: "settings", page: "people" } },
  remoteDesktop: { place: "Settings, Devices", to: { view: "settings", page: "devices" } },
  storage: { place: "Settings, Storage", to: { view: "settings", page: "storage" } },
  code: { place: "Code", to: { view: "code" } },
  apple: { place: "Settings, Apple", to: { view: "settings", page: "apple" } },
};

const ICONS: Record<FeatureKey, ReactNode> = {
  background: <Bell size={18} />,
  routines: <Clock size={18} />,
  teach: <CircleDot size={18} />,
  tasks: <ListChecks size={18} />,
  buddy: <Ghost size={18} />,
  invite: <UserPlus size={18} />,
  remoteDesktop: <MonitorSmartphone size={18} />,
  storage: <HardDrive size={18} />,
  code: <SquareTerminal size={18} />,
  apple: <Apple size={18} />,
};

/**
 * Mods: the optional parts of Wisp, switched on or off for the whole organization. Owners
 * change them (or ask an agent to); everyone else can see them.
 */
export function ModsPage() {
  const features = useFeatures();
  const isOwner = useStore((s) => s.me?.role) === "owner";
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<FeatureKey | null>(null);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 8000);
    return () => clearTimeout(t);
  }, [added]);

  const save = async (patch: Partial<Features>) => {
    setError(null);
    try {
      await setFeatures(patch);
      const turnedOn = FEATURE_KEYS.find((k) => patch[k] === true);
      setAdded(turnedOn ?? null);
    } catch (e) {
      setError(`Couldn't save that: ${(e as Error).message}`);
    }
  };

  const listed = FEATURE_KEYS.filter((k) => !UNLISTED_FEATURES.includes(k));
  const on = listed.filter((k) => features[k]);
  const off = listed.filter((k) => !features[k]);
  const card = (k: FeatureKey, control: ReactNode) => (
    <div key={k} className="rounded-2xl border border-line p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <span className="size-9 shrink-0 rounded-lg bg-chip text-ink/80 grid place-items-center" aria-hidden>
          {ICONS[k]}
        </span>
        <span className="flex-1 min-w-0 text-body font-medium">{FEATURE_INFO[k].name}</span>
        {control}
      </div>
      <p className="text-sm leading-snug text-ink/75">{FEATURE_INFO[k].description}</p>
    </div>
  );

  return (
    <div className="space-y-8">
      <h2 className="t-title max-md:hidden">Mods</h2>
      {isOwner ? <AskAgent placeholder={`Ask {name}, like "turn on routines"`} /> : <p className="text-sm text-muted">Only owners can turn mods on or off.</p>}
      {on.length > 0 && (
        <section className="space-y-2.5" aria-labelledby="mods-on">
          <h3 id="mods-on" className="text-body font-semibold text-muted">
            On
          </h3>
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">{on.map((k) => card(k, <Switch on label={FEATURE_INFO[k].name} disabled={!isOwner} onChange={(v) => save({ [k]: v })} />))}</div>
        </section>
      )}
      {off.length > 0 && (
        <section className="space-y-2.5" aria-labelledby="mods-more">
          <h3 id="mods-more" className="text-body font-semibold text-muted">
            More mods
          </h3>
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
            {off.map((k) =>
              card(
                k,
                <Button className="h-8 px-3.5 text-[13px]" disabled={!isOwner} onClick={() => save({ [k]: true })}>
                  Add
                </Button>,
              ),
            )}
          </div>
        </section>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
      {added && (
        <div role="status" className="m-toast glass fixed z-50 right-6 bottom-6 w-[380px] max-md:inset-x-[18px] max-md:w-auto max-md:right-auto max-md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] rounded-3xl pl-5 pr-4 py-4 flex items-center gap-2.5">
          <span className="flex-1 text-body font-medium">
            {FEATURE_INFO[added].name} is on — in {MOD_HOME[added].place}
          </span>
          {MOD_HOME[added].to && (
            <button
              className="h-11 px-[18px] rounded-full bg-accent text-accent-ink text-body font-medium"
              onClick={() => {
                go(MOD_HOME[added].to!);
                setAdded(null);
              }}
            >
              Open
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx("shrink-0 w-[46px] h-7 rounded-full p-[3px] flex transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-3 focus-visible:ring-ring/40", on ? "bg-accent" : "bg-input")}
    >
      <span className={cx("m-knob size-[22px] rounded-full shadow", on ? "bg-accent-ink translate-x-[18px]" : "bg-white")} />
    </button>
  );
}
