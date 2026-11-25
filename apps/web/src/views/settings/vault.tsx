import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, ExternalLink, FolderOpen, Globe, KeyRound, ShieldCheck } from "lucide-react";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { useStore } from "../../store.ts";
import { Add, Badge, Item, Label, Note, Panel, Prim, Tile } from "../../components/MarketParts.tsx";

interface VaultView {
  /** this Wisp's server runs the vault (Vaultwarden + its bridge) */
  available: boolean;
  vaultUrl: string | null;
  bridge: { state: "not_connected" | "locked" | "ready" | "unavailable"; account: string | null; lockOnRestart: boolean; problem: string | null } | null;
  /** agents use the Wisp vault for logins now */
  inUse: boolean;
}

const TURN_ON = "sudo sh -c 'cd /opt/wisp && docker compose exec -T wisp cat docker/vault.sh > vault.sh && sh vault.sh on'";

/**
 * Settings → Memory vault: what the server keeps for agents. Passwords live in the Wisp vault
 * (Vaultwarden, used with the official Bitwarden apps); the person makes their account on the
 * vault's own page and signs the agents' account in on the bridge's page, so Wisp never sees either
 * master password. Memory has its own pages, linked here.
 */
export function VaultPage() {
  const isOwner = useStore((s) => s.me)?.role === "owner";
  const [view, setView] = useState<VaultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<VaultView>("GET", "/api/logins/vault").then(setView, (e) => setError((e as Error).message));
  useEffect(() => {
    void load();
    // the person connects on the bridge's page in another tab: show it once they come back
    const back = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void load();
    }
  };
  // a single-use link (10 minutes) to the bridge's own page: the person signs the agents' account in there
  const [link, setLink] = useState<string | null>(null);
  const connect = () => run(async () => setLink((await api<{ url: string }>("POST", "/api/logins/vault/connect-link")).url));
  const use = () => run(() => api("PUT", "/api/logins/source", { kind: "wisp-vault" }));
  const forget = () => {
    if (!confirm("Sign the agents' account out of the vault? Agents stop being able to fill logins from it.")) return;
    void run(() => api("DELETE", "/api/logins/vault/account"));
  };

  const b = view?.bridge;
  const agentsSub = !b ? "" : b.state === "ready" ? (b.account ?? "Connected") : b.state === "locked" ? "Locked: connect again" : b.state === "unavailable" ? "Not answering" : "Not connected";

  return (
    <>
      {error && <p className="mb-4 text-sm text-bad">{error}</p>}
      {view && (
        <div className="space-y-7">
          <section className="space-y-2">
            <Label>Passwords</Label>
            {!view.available ? (
              <>
                <Panel>
                  <Item icon={<Tile size={50}><KeyRound size={22} strokeWidth={1.7} /></Tile>} title="Wisp vault" sub="Off on this server" />
                </Panel>
                {isOwner && (
                  <div className="space-y-1.5 px-1 text-sm text-faint">
                    <p>To turn it on, run this on your Wisp server:</p>
                    <code className="block select-all break-all rounded-xl bg-chip px-3 py-2 font-mono text-[13px] text-ink">{TURN_ON}</code>
                  </div>
                )}
              </>
            ) : (
              <>
                <Panel>
                  <Item
                    icon={<Tile size={50}><KeyRound size={22} strokeWidth={1.7} /></Tile>}
                    title="Wisp vault"
                    sub="Your passwords, in the Bitwarden apps"
                    right={
                      view.vaultUrl ? (
                        <a className="inline-flex h-[38px] items-center gap-1.5 rounded-full px-[14px] text-body text-accent-text hover:bg-hover" href={view.vaultUrl} target="_blank" rel="noreferrer">
                          Open <ExternalLink size={13} />
                        </a>
                      ) : undefined
                    }
                  />
                  <Item
                    icon={<Tile size={50}><ShieldCheck size={22} strokeWidth={1.7} /></Tile>}
                    title="Agents' account"
                    sub={agentsSub}
                    right={
                      isOwner ? (
                        b?.state === "ready" ? (
                          <>
                            {view.inUse ? <Badge tone="green">Agents use it</Badge> : <Prim className="h-[38px] px-[18px] text-body" disabled={busy} onClick={use}>Use for agents</Prim>}
                            <Add onClick={forget} disabled={busy}>Disconnect</Add>
                          </>
                        ) : link ? (
                          <a className="inline-flex h-[38px] items-center gap-1.5 rounded-full bg-accent px-[18px] text-body font-medium text-accent-ink hover:bg-accent/90" href={link} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => setLink(null), 500)}>
                            Sign it in <ExternalLink size={13} />
                          </a>
                        ) : (
                          <Prim className="h-[38px] px-[18px] text-body" disabled={busy || b?.state === "unavailable"} onClick={connect}>
                            Connect
                          </Prim>
                        )
                      ) : undefined
                    }
                  />
                  <Item icon={<Tile size={50}><Globe size={22} strokeWidth={1.7} /></Tile>} title="Logins agents can use" href={href({ view: "settings", page: "logins" })} right={<ChevronRight size={15} className="text-faint" aria-hidden />} />
                </Panel>
                {b?.problem && b.state !== "ready" && <Note tone="warn">{b.problem}</Note>}
                {view.vaultUrl && (
                  <p className="px-1 text-[13px] text-faint">
                    In the Bitwarden app or extension, choose self-hosted and use <span className="select-all text-ink">{view.vaultUrl}</span>. Agents only see logins you put in the “Agents” folder or collection of their own account. Give them only logins you'd hand an assistant.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="space-y-2">
            <Label>Memory</Label>
            <Panel>
              <Item icon={<Tile size={50}><BookOpen size={22} strokeWidth={1.7} /></Tile>} title="Memory access" href={href({ view: "settings", page: "memory", item: "memory-access" })} right={<ChevronRight size={15} className="text-faint" aria-hidden />} />
              <Item icon={<Tile size={50}><FolderOpen size={22} strokeWidth={1.7} /></Tile>} title="Memory folder" href={href({ view: "settings", page: "memory", item: "memory-folder" })} right={<ChevronRight size={15} className="text-faint" aria-hidden />} />
            </Panel>
          </section>
        </div>
      )}
    </>
  );
}
