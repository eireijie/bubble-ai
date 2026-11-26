import { GITHUB_URL } from "@bubble-ai/core";
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { href } from "../../router.ts";
import { Button, Modal } from "../../components/ui.tsx";
import { MotionMark } from "../../components/MotionMark.tsx";
import { DesktopUpdates } from "./DesktopUpdates.tsx";
import { RemoveWispRow } from "./RemoveWisp.tsx";
import { HubAddress } from "./workspace.tsx";
import { Card, Row } from "./parts.tsx";
import { Group, Note, SRow } from "./rows.tsx";

interface UpdateInfo {
  version: { commit: string | null; date: string | null };
  check: { behind: number | null; changes: string[]; canUpdate: boolean; reason: string } | null;
  update: { state: "idle" | "updating" | "restarting" | "failed"; message: string; log: string[] };
}

/** A commit line ("8f380af Settings pages share one look") without its hash. */
const subject = (line: string) => line.slice(line.indexOf(" ") + 1);

/** The About page: the hub's version, what's new, and the update flow: available, confirm, updating, failed. The page reloads once the hub is back. */
export function AboutPage() {
  const isOwner = useStore((s) => s.me)?.role === "owner";
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [spin, setSpin] = useState(0);
  const check = async () => {
    setChecking(true);
    try {
      setInfo(await api<UpdateInfo>("POST", "/api/updates/check"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    api<UpdateInfo>("GET", "/api/updates").then(setInfo, () => {});
    check();
  }, []);

  // while the hub updates, follow along; it goes away while restarting, then comes back on the new version
  const busy = !!restarting || info?.update.state === "updating" || info?.update.state === "restarting";
  useEffect(() => {
    if (!busy) return;
    const from = restarting ?? info?.version.commit ?? null;
    const t = setInterval(async () => {
      const next = await api<UpdateInfo>("GET", "/api/updates").catch(() => null);
      if (!next) return setRestarting(from ?? "");
      if (next.update.state === "restarting") setRestarting(from ?? "");
      if (restarting !== null && next.version.commit !== restarting) return location.reload();
      setInfo(next);
    }, 2000);
    return () => clearInterval(t);
  }, [busy, restarting]);

  const update = async () => {
    setError(null);
    setConfirm(false);
    setDismissed(false);
    try {
      const r = await api<{ update: UpdateInfo["update"] }>("POST", "/api/updates/hub");
      setInfo((i) => i && { ...i, update: r.update });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const desktop = typeof window !== "undefined" && !!window.wispDesktop?.updates;
  // the app's own version number (the hub's commit only exists in a git checkout)
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    window.wispDesktop?.updates.status().then((s) => s?.current && setAppVersion(s.current), () => {});
  }, []);
  const v = info?.version;
  const c = info?.check;
  const u = info?.update;

  if (busy)
    return (
      <div className="min-h-[60vh] grid place-items-center text-center">
        <div className="max-w-sm space-y-3">
          <h2 className="t-title">Updating Bubble AI</h2>
          <p className="text-body text-muted">This page reloads by itself when the hub is back.</p>
          <p className="text-sm text-faint" role="status">
            {restarting !== null || u?.state === "restarting" ? "Restarting the hub…" : (u?.log.at(-1) ?? "Updating…")}
          </p>
        </div>
      </div>
    );
  if (u?.state === "failed" && !dismissed)
    return (
      <div className="min-h-[60vh] grid place-items-center text-center">
        <div className="max-w-sm space-y-4">
          <h2 className="t-title">The update didn't finish</h2>
          <p className="text-body text-muted">Bubble AI is still running the version it had. Nothing was lost.</p>
          <p className="text-sm text-bad whitespace-pre-wrap">{u.message}</p>
          <div className="flex justify-center gap-2">
            {isOwner && (
              <Button variant="primary" onClick={update}>
                Try again
              </Button>
            )}
            <Button onClick={() => setDismissed(true)}>Back</Button>
          </div>
        </div>
      </div>
    );
  // in the desktop app its own copy of Bubble AI updates with the app, so the hub's git check only shows when it can act
  const hubShown = !desktop || !!c?.canUpdate;
  const status = !c ? (checking ? "Checking…" : "Not checked") : c.canUpdate ? "Update available" : c.behind === 0 ? "Up to date" : "Can't update here";
  const version = `Bubble AI${appVersion ? ` ${appVersion}` : ""}${v?.commit ? ` ${v.commit}` : ""}${v?.date ? ` · ${new Date(v.date).toLocaleDateString()}` : ""}`;
  return (
    <>
      {/* hover the name and the bubble spins and jiggles; click the bubble and it pops and a new one spins up */}
      <div className="flex flex-col items-center gap-3 pt-2 pb-6">
        <MotionMark size={80} spin={spin} popOnClick label="Bubble AI" />
        <span className="text-[22px] font-semibold tracking-[-0.03em] text-ink" onPointerEnter={() => setSpin((n) => n + 1)}>
          Bubble AI
        </span>
      </div>
      {desktop && <DesktopUpdates />}
      <Group>
        <SRow id="version" value={hubShown ? `${version} · ${status}` : version}>
          {hubShown &&
            (c?.canUpdate && isOwner ? (
              <Button variant="primary" onClick={() => setConfirm(true)}>
                Update
              </Button>
            ) : (
              <Button onClick={check} disabled={checking}>
                {checking ? "Checking…" : "Check now"}
              </Button>
            ))}
        </SRow>
      </Group>
      {hubShown && c && !c.canUpdate && c.behind !== 0 && c.reason && <Note>{c.reason}</Note>}
      {u?.state === "failed" && (
        <Note bad>
          The last update didn't finish: {u.message}{" "}
          {isOwner && (
            <button className="underline" onClick={update}>
              Try again
            </button>
          )}
        </Note>
      )}
      {u?.state === "idle" && u.message && <Note>{u.message}</Note>}
      {error && <Note bad>{error}</Note>}
      <Group>
        <SRow id="news" />
        <SRow id="help" to={href({ view: "help" })} />
        <SRow id="source" to={GITHUB_URL} external value="GitHub" />
      </Group>
      <Group title="More">
        <SRow id="hub" value={<HubAddress />} />
        <SRow id="welcome" to={href({ view: "welcome", intro: true })} />
        <RemoveWispRow />
      </Group>
      {confirm && (
        <Modal title="Update and restart the hub?" onClose={() => setConfirm(false)}>
          <p className="text-body text-muted mb-5">Everyone will briefly disconnect. Bubble AI comes back by itself.</p>
          <div className="flex flex-col gap-2">
            <Button variant="primary" className="h-12" onClick={update}>
              Update and restart
            </Button>
            <Button variant="ghost" className="h-12" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** What's new: what the next update brings, one line each. */
export function WhatsNewPage() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    api<UpdateInfo>("POST", "/api/updates/check").then(setInfo, () => api<UpdateInfo>("GET", "/api/updates").then(setInfo, () => {}));
  }, []);
  const changes = info?.check?.changes ?? [];
  return <Card>{changes.length ? changes.map((line) => <Row key={line} label={subject(line)} />) : <Row label={info ? "Nothing new right now" : "Loading…"} />}</Card>;
}
