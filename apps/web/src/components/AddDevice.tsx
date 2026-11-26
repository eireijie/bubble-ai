import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import {
  Cloud,
  Download,
  Laptop,
  Monitor,
  Server,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import { api } from "../api.ts";
import { useDevices } from "../devices.ts";
import { go } from "../router.ts";
import {
  linkReach,
  shareOrigin,
  useAccess,
  useAccessStore,
} from "../access.ts";
import { AwayFromHome } from "./Access.tsx";
import { RELEASES } from "../downloads.ts";
import { unavailable } from "../join.ts";
import { useStore } from "../store.ts";
import { canApproveJoin } from "../join.ts";
import { PhonePairing } from "../views/settings/mobile.tsx";
import { Button, CopyBlock, Modal, touchFirst } from "./ui.tsx";

/** Today's steps for a phone and for another computer. `only` shows one of the two. */
export function AddDeviceContent({ phone = true, only }: { phone?: boolean; only?: "phone" | "computer" }) {
  const showPhone = only ? only === "phone" : phone;
  const showComputer = only !== "phone";
  const allowed = useStore((s) => canApproveJoin(s.me?.role));
  const info = useAccess();
  const [invite, setInvite] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingUpAway, setSettingUpAway] = useState(false);
  // a new phone code after Away from home turns on, so it carries the new address
  const [pairingRound, setPairingRound] = useState(0);
  const reach = linkReach(
    invite?.url ?? (info ? shareOrigin(info) : null),
    info,
  );
  const makeInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      setInvite(await api("POST", "/api/join/invites"));
    } catch (e) {
      setError(unavailable(e, "Invite links"));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (allowed) void makeInvite();
  }, [allowed]);
  const expired = invite && Date.parse(invite.expiresAt) <= Date.now();
  return (
    <div className="space-y-4">
      {info && reach === "wifi" && (
        <div className="rounded-2xl border border-line p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Wifi size={18} className="text-muted" />
            <p className="flex-1 text-sm">These only work on this Wi-Fi.</p>
            {allowed && !settingUpAway && (
              <Button onClick={() => setSettingUpAway(true)}>
                Turn on Away from home
              </Button>
            )}
          </div>
          {settingUpAway && (
            <AwayFromHome
              onDone={() => {
                setSettingUpAway(false);
                setPairingRound((n) => n + 1);
                void useAccessStore.getState().refresh(true);
                if (allowed) void makeInvite();
              }}
            />
          )}
        </div>
      )}
      {reach === "tailscale" && (
        <p className="flex items-center gap-3 rounded-2xl border border-line p-4 text-sm">
          <ShieldCheck size={18} className="text-muted" />
          Away from home, the other device needs Tailscale too, signed in to the
          same account.
        </p>
      )}
      <div className={showPhone && showComputer ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
        {showPhone && (
          <section className="rounded-2xl border border-line p-5 space-y-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <Smartphone size={20} />
              Phone
            </h3>
            <PhonePairing key={pairingRound} autoStart compact />
          </section>
        )}
        {showComputer && <section className="rounded-2xl border border-line p-5 space-y-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Monitor size={20} />
            Another computer
          </h3>
          <ol className="space-y-4 text-sm list-decimal pl-5 marker:text-muted">
            <li className="pl-1">
              Get Bubble AI on it:
              <br />
              <a
                href={RELEASES}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-ink underline"
              >
                <Download size={15} />
                Download Bubble AI
              </a>
            </li>
            <li className="pl-1">
              Pick <strong className="font-medium">Join my Bubble AI</strong>.
              <span className="block mt-1 text-muted">
                On this Wi-Fi it finds you.
              </span>
            </li>
            <li className="pl-1">Approve it here.</li>
          </ol>
          <div className="border-t border-line pt-4 space-y-3">
            <p className="text-sm">
              {reach === "wifi"
                ? "Not found? Paste this link in Join my Bubble AI."
                : "Somewhere else? Send it this invite link."}
            </p>
            {invite && !expired && <CopyBlock text={invite.url} />}
            {!allowed && (
              <p className="text-sm text-muted">
                Ask your Bubble AI's owner for an invite link.
              </p>
            )}
            {busy && (
              <p role="status" className="text-sm text-muted">
                Making an invite link…
              </p>
            )}
            {error && (
              <p role="status" className="text-sm text-muted">
                {error}
              </p>
            )}
            {allowed && !busy && (!invite || expired) && (
              <Button onClick={() => void makeInvite()}>
                <RefreshCw size={14} />
                {expired ? "Make a new link" : "Try again"}
              </Button>
            )}
          </div>
        </section>}
      </div>
    </div>
  );
}

/** The dialog that makes an agent's computer: loaded when "This computer", "A Linux computer" or "A cloud computer" is picked. */
const AddComputer = lazy(() => import("../views/ComputersView.tsx").then((m) => ({ default: m.AddComputer })));

/** Where the Add dialog is: the list of what can be added, or one thing's steps. */
export type AddStep = "list" | "here" | "linux" | "computer" | "phone" | "cloud";

const ADD_ROWS: { step: Exclude<AddStep, "list">; label: string; icon: ReactNode }[] = [
  { step: "here", label: "This computer", icon: <Laptop size={18} strokeWidth={1.8} /> },
  { step: "linux", label: "A Linux computer", icon: <Server size={18} strokeWidth={1.8} /> },
  { step: "computer", label: "Another computer", icon: <Monitor size={18} strokeWidth={1.8} /> },
  { step: "phone", label: "A phone", icon: <Smartphone size={18} strokeWidth={1.8} /> },
  { step: "cloud", label: "A cloud computer", icon: <Cloud size={18} strokeWidth={1.8} /> },
];

/**
 * Add: one list of what can be added, each row leading to its steps. This computer, a Linux
 * computer (a VM on one of your devices) and a cloud computer make a computer for agents; another
 * computer joins this Bubble AI; a phone pairs.
 */
export function AddDeviceDialog({ onClose, start = "list" }: { onClose: () => void; start?: AddStep }) {
  const [step, setStep] = useState<AddStep>(start);
  const devices = useDevices();
  if (step === "here" || step === "linux" || step === "cloud")
    return (
      <Suspense fallback={null}>
        <AddComputer devices={devices ?? []} only={step} onClose={onClose} onCreated={(c) => (onClose(), go({ view: "computers", computerId: c.id }))} />
      </Suspense>
    );
  if (step === "list")
    return (
      <Modal title="Add" onClose={onClose}>
        <div className="overflow-hidden rounded-[12px] bg-card divide-y divide-line">
          {/* a phone can't run agents itself: no "This computer" there, the rest add one that can */}
          {ADD_ROWS.filter((r) => r.step !== "here" || !touchFirst()).map((r) => (
            <button key={r.step} type="button" onClick={() => setStep(r.step)} className="flex h-[51px] w-full items-center gap-3 px-3.5 text-left text-[14px] font-medium hover:bg-hover">
              <span className="shrink-0 text-muted">{r.icon}</span>
              {r.label}
            </button>
          ))}
        </div>
      </Modal>
    );
  return (
    <Modal title={step === "phone" ? "A phone" : "Another computer"} onClose={onClose}>
      <div className="pt-3">
        <AddDeviceContent only={step} />
      </div>
      <div className="flex justify-end mt-5">
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}
