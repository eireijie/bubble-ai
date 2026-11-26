import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, KeyRound, Trash2 } from "lucide-react";
import { api } from "../../api.ts";
import { useStore } from "../../store.ts";
import { Button, CopyBlock, Input, timeAgo } from "../../components/ui.tsx";
import { obsidianLink, onHubMachine, type MemoryStorage } from "../../obsidian.ts";
import { Card, Row } from "./parts.tsx";
import { MemoryImport, type Askable } from "../../components/MemoryImport.tsx";
import { useDevices } from "../../devices.ts";

const Code = ({ children }: { children: ReactNode }) => <code className="rounded bg-code px-1 py-0.5 text-[12px] break-all">{children}</code>;

/** Where memory is kept, loaded once for the sheet that needs it. */
function useMemoryStorage() {
  const [storage, setStorage] = useState<MemoryStorage | null>(null);
  const load = useCallback(() => api<MemoryStorage>("GET", "/api/memory/storage").then(setStorage, () => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  return { storage, load };
}

/** What the Memory folder row says: the folder. */
export function MemoryFolderValue() {
  const { storage } = useMemoryStorage();
  return <>{storage?.path ?? ""}</>;
}

/** Memory folder: where notes are kept, and moving them. */
export function MemoryFolderPage() {
  const isOwner = useStore((s) => s.me)?.role === "owner";
  const { storage, load } = useMemoryStorage();
  if (!storage) return null;
  if (!isOwner) return storage.path ? <Code>{storage.path}</Code> : null;
  return <Location storage={storage} reload={load} />;
}

/** Sync to Obsidian: open the folder there, or sync another computer with a token. */
export function ObsidianPage() {
  const { storage, load } = useMemoryStorage();
  return storage ? <ObsidianSteps storage={storage} reload={load} /> : null;
}

function Location({ storage, reload }: { storage: MemoryStorage; reload: () => void }) {
  const [draft, setDraft] = useState(storage.setting ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const fixed = storage.source === "env" || storage.movable === false;
  const save = async (path: string | null) => {
    setError(null);
    setBusy(true);
    try {
      await api("PUT", "/api/memory/storage", { path });
      if (path === null) setDraft("");
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {storage.path && (
        <Card>
          <div className="px-4 py-3.5 space-y-1.5">
            <div>
              <Code>{storage.path}</Code>
            </div>
            {fixed && <div className="text-xs text-muted">{storage.movable === false ? "An extra workspace's memory can't be moved." : "Set by BUBBLE_VAULT_DIR where Bubble AI runs."}</div>}
          </div>
          {!fixed && (
            <form
              className="px-4 py-3.5 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                save(draft.trim() || null);
              }}
            >
              <label className="text-sm font-medium" htmlFor="vault-folder">
                Use a different folder
              </label>
              <div className="flex flex-wrap gap-2">
                <Input id="vault-folder" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="/Users/you/Documents/My Obsidian vault" className="flex-1 min-w-48" />
                <Button variant="primary" disabled={busy || draft.trim() === (storage.setting ?? "")}>
                  Save
                </Button>
                {storage.setting && (
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => save(null)}>
                    Use the default
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">The full path on the machine that runs Bubble AI. In Docker, a folder inside a volume you mounted.</p>
              {error && <p className="text-sm text-bad">{error}</p>}
            </form>
          )}
        </Card>
      )}
      {storage.pendingRestart && (
        <div className="mt-3 rounded-xl bg-accent-soft p-4 text-sm space-y-2">
          <p>
            Bubble AI will use <Code>{storage.nextPath}</Code> after it restarts.
          </p>
          {storage.restartable ? (
            <Button
              variant="primary"
              disabled={restarting}
              onClick={async () => {
                setRestarting(true);
                await api("POST", "/api/memory/storage/restart").catch(() => {});
                setTimeout(() => window.location.reload(), 4000);
              }}
            >
              {restarting ? "Restarting…" : "Restart Bubble AI now"}
            </Button>
          ) : (
            <p className="text-muted">Stop Bubble AI and start it again to switch.</p>
          )}
        </div>
      )}
      {storage.previous && (
        <p className="mt-3 text-sm text-muted">
          Earlier copy kept in <Code>{storage.previous}</Code>.
        </p>
      )}
    </div>
  );
}

function ObsidianSteps({ storage, reload }: { storage: MemoryStorage; reload: () => void }) {
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const local = onHubMachine();
  const remoteUrl = (token: string) => {
    const u = new URL(window.location.origin);
    u.username = "wisp";
    u.password = token;
    u.pathname = storage.sync.urlPath;
    return u.toString();
  };
  const create = async () => {
    setError(null);
    try {
      const r = await api<{ token: string }>("POST", "/api/memory/tokens", { label });
      setFresh(r.token);
      setLabel("");
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div>
      <div className="space-y-4">
        {storage.path && (
          <Card>
            <div className="px-4 py-3.5 space-y-2">
              <div className="text-sm font-medium">On the computer that runs Bubble AI</div>
              <p className="text-sm text-muted">
                Open <Code>{storage.path}</Code> as a vault.
              </p>
              {local && (
                <a href={obsidianLink(storage.path)} className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-line px-3 text-sm font-medium hover:bg-hover whitespace-nowrap">
                  <ExternalLink size={15} /> Open in Obsidian
                </a>
              )}
            </div>
          </Card>
        )}

        <div className="rounded-xl border border-line p-4 space-y-4">
          <h4 className="text-sm font-semibold">On another computer</h4>

          {!storage.sync.allowed ? (
            <p className="text-sm rounded-lg bg-hover p-3">{storage.sync.reason}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. My laptop" className="max-w-56" aria-label="Token name" />
                <Button onClick={create}>
                  <KeyRound size={15} /> Create token
                </Button>
              </div>
              {error && <p className="text-sm text-bad">{error}</p>}
              <CopyBlock text={`git clone "${remoteUrl(fresh ?? "YOUR-TOKEN")}" "Bubble AI memory"`} />
              {!fresh && <p className="text-xs text-muted">Replace YOUR-TOKEN with a token. It's shown once.</p>}
              {window.location.protocol === "http:" && !local && <p className="text-xs text-muted">This address isn't encrypted. Use it only on your home network or a private one like Tailscale.</p>}
              {/* what a token gives away, so nobody hands one out lightly */}
              <p className="text-xs text-muted">A token reads all of memory, history included. Revoke it the moment a computer is lost.</p>
            </>
          )}
        </div>

        {storage.tokens.length > 0 && (
          <div>
            <h4 className="mb-2 px-1 text-[13px] font-semibold text-muted">Tokens</h4>
            <Card>
              {storage.tokens.map((t) => (
                <Row key={t.id} label={t.label || "Obsidian"} hint={`Made ${timeAgo(t.createdAt)} · ${t.lastUsed ? `last used ${timeAgo(t.lastUsed)}` : "never used"}`}>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(`Stop "${t.label || "Obsidian"}" from syncing? That computer keeps its copy but can't pull or push any more.`)) return;
                      await api("DELETE", `/api/memory/tokens/${t.id}`).catch(() => {});
                      reload();
                    }}
                  >
                    <Trash2 size={15} /> Revoke
                  </Button>
                </Row>
              ))}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/** Bring what another AI knows about you into one agent's notes: the same step as first-run setup. */
export function ImportFromAI() {
  const agents = useStore((s) => s.agents);
  const me = useStore((s) => s.me);
  const devices = useDevices();
  const mine = agents.filter((a) => a.settings.createdBy === me?.user.id || me?.role === "owner");
  const [agentId, setAgentId] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const agent = mine.find((a) => a.id === agentId) ?? mine[0];
  if (!agent) return null;
  const askable: Askable[] = (devices ?? []).filter((d) => d.mine && d.online).flatMap((d) => ["claude-code", "codex"].filter((h) => d.harnesses?.some((x) => x.id === h)).map((harness) => ({ harness, nodeId: d.id, device: d.name })));
  return (
    <div>
      {!open ? (
        <Card>
          <Row label="Import into" hint={done}>
            <div className="flex items-center gap-2">
              {mine.length > 1 && (
                <select className="h-9 rounded-lg border border-line bg-card px-2 text-[13.5px]" aria-label="Agent" value={agent.id} onChange={(e) => setAgentId(e.target.value)}>
                  {mine.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <Button
                onClick={() => {
                  setDone(null);
                  setOpen(true);
                }}
              >
                {mine.length > 1 ? "Start" : `Import into ${agent.name}`}
              </Button>
            </div>
          </Row>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <MemoryImport
            agentName={agent.name}
            askable={askable}
            saveLabel={`Save to ${agent.name}'s memory`}
            skipLabel="Cancel"
            busy={busy}
            onSkip={() => setOpen(false)}
            onSave={async (lines) => {
              setBusy(true);
              setError(null);
              try {
                const r = await api<{ saved: number }>("POST", `/api/agents/${agent.id}/memory-import`, { lines: lines.map((l) => ({ heading: l.heading, text: l.text })) });
                setDone(`${r.saved} saved to ${agent.name}'s notes.`);
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
          {error && <p className="text-[13px] text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}
