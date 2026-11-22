import { useState } from "react";
import { ExternalLink, LogIn, MoreHorizontal } from "lucide-react";
import { SIGN_IN_PROVIDERS, connectorUnsupportedReason, trustLabel, type Agent, type AppCategory, type CatalogConnector, type Connector, type MarketplaceInstall, type SignInOption, type StoreApp } from "@wisp/core";
import { api } from "../api.ts";
import { Button, Menu } from "../components/ui.tsx";
import { WhoCanUse, whoLine } from "../components/ShopParts.tsx";
import { AppTile, Dlg, FactRow, ItemHead, Prim, RemoveBtn, Rows, TrustPill } from "../components/MarketParts.tsx";
import { connectSummary, connectorWhere, registryCatalog } from "./ConnectorsView.tsx";

export type AppItem = { key: string; name: string; description: string; category: AppCategory | null; who: string } & ({ registry: StoreApp } | { builtIn: CatalogConnector });

const HARNESS_NAMES: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", hermes: "Hermes" };

/** Why signing in to an app doesn't work from where Wisp is open, and what to do instead (or, where it does, what happens). */
export function howToSignIn(name: string, o: SignInOption): string {
  if (o.signIn) return `A page opens in your browser to sign in to ${name}. Wisp never sees your password.`;
  return `${o.reason ?? `Signing in to ${name} doesn't work from here.`}${o.key ? " You can use a key instead." : ""}`;
}

/** Who made an app, where Wisp can say: the maker the registry confirmed, the company its sign-in goes to, else its publisher. */
export function appMaker(app: AppItem): string | null {
  if ("registry" in app) {
    const t = trustLabel(app.registry);
    return t.kind === "maker" ? t.text.replace(/^Made by /, "") : app.registry.publisher;
  }
  const s = app.builtIn.signIn;
  return s?.via === "app" ? SIGN_IN_PROVIDERS[s.provider].name : null;
}

/** The one muted line under an app's name: what it is and who made it ("Email and calendar · by Google"). */
export function appLine(app: AppItem): string {
  const maker = appMaker(app);
  return [app.category ?? "App", maker && `by ${maker}`].filter(Boolean).join(" · ");
}

/** The same line for an added app Wisp has no catalog entry for: one brought in from a harness, or the person's own. */
export function connectorLine(c: Pick<Connector, "catalogId">): string {
  const id = c.catalogId ?? "";
  return id.startsWith("device:") ? `App · from ${HARNESS_NAMES[id.split(":")[2]] ?? "a computer"}` : "Your own app";
}

/**
 * An app's page, before and after it is added: its tile, name and one line; one action (Add, or
 * Sign in again when the sign-in lapsed); one card of rows (who can use it, what it may do, the
 * account); trust and the rest under More; Remove set apart at the bottom.
 */
export function AppPage({
  app,
  have,
  agents,
  canEdit,
  signIn,
  onAdd,
  onUseKey,
  onChanged,
  onSignIn,
  onSignOut,
  onEdit,
  onToggle,
  onRemove,
}: {
  app: AppItem | null;
  have: Connector | undefined;
  agents: Agent[];
  canEdit: boolean;
  signIn?: SignInOption;
  onAdd: (install: number) => void;
  onUseKey?: () => void;
  onChanged: () => void;
  onSignIn: (c: Connector) => void;
  onSignOut: (c: Connector) => void;
  onEdit: (c: Connector) => void;
  onToggle: (c: Connector) => void;
  onRemove: (c: Connector) => void;
}) {
  const [pick, setPick] = useState(0);
  const [more, setMore] = useState(false);
  const [who, setWho] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registry = app && "registry" in app ? app.registry : null;
  const builtIn = app && "builtIn" in app ? app.builtIn : null;
  const install: MarketplaceInstall | null = registry ? (registry.installs[pick] ?? registry.installs[0] ?? null) : null;
  const entry = builtIn ?? (registry && install ? registryCatalog(registry, install) : null);
  const summary = builtIn ? connectSummary({ builtIn }) : registry && install ? connectSummary({ entry: registry, install }) : null;
  const trust = registry ? trustLabel(registry) : null;
  const link = registry?.website ?? registry?.repository ?? builtIn?.docs;
  const name = have?.name ?? app?.name ?? "";
  const description = app?.description ?? "";
  // signs in only (Gmail, Calendar) and that doesn't work from here: nothing to add it with
  const blocked = !!signIn && !signIn.signIn && !signIn.key && !!entry && !entry.fields.length;
  const lapsed = !!have?.auth?.required && !have.auth.signedIn;
  const kind = have?.kind ?? entry?.kind;
  const can = builtIn?.signInReads ?? signIn?.reads ?? (kind === "secret" || entry?.fields.length ? "Use your key" : "What the app allows");
  const where = have ? connectorWhere(have) : "";

  const change = async (p: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await p();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const account = have
    ? [
        ...(have.kind === "mcp-http" ? [{ label: have.auth?.signedIn ? "Sign in again" : "Sign in", onSelect: () => onSignIn(have) }] : []),
        ...(have.auth?.signedIn ? [{ label: "Sign out", onSelect: () => onSignOut(have) }] : []),
        { label: "Refresh", onSelect: onChanged },
        ...(onUseKey ? [{ label: "Use a key instead", onSelect: onUseKey }] : []),
      ]
    : [];
  const accountLabel = have?.kind === "mcp-http" ? "Signed in as" : "Uses";
  const accountValue = have?.kind === "mcp-http" ? (lapsed ? "Sign in again" : have.auth?.signedIn ? "Your account" : "Not needed") : where;

  return (
    <div className="space-y-4">
      <ItemHead tile={<AppTile name={name} category={app?.category} size={56} entry={registry} />} name={name} line={`${app ? appLine(app) : have ? connectorLine(have) : ""}${have && !have.enabled ? " · Off" : ""}`}>
        {canEdit && !have && (
          <Button variant="primary" onClick={() => onAdd(pick)} disabled={!entry || blocked}>
            Add
          </Button>
        )}
        {canEdit && have && lapsed && (
          <Button variant="primary" onClick={() => onSignIn(have)}>
            Sign in again
          </Button>
        )}
        {canEdit && have && (
          <Menu
            align="right"
            items={[
              { label: "Edit settings", onSelect: () => onEdit(have) },
              ...(link ? [{ label: "Website", onSelect: () => void window.open(link, "_blank", "noreferrer") }] : []),
              { label: have.enabled ? "Turn off" : "Turn on", onSelect: () => onToggle(have) },
            ]}
            trigger={(open, toggle) => (
              <button type="button" className="circle circle-sm" aria-label={`More for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                <MoreHorizontal size={16} aria-hidden />
              </button>
            )}
          />
        )}
      </ItemHead>

      {have?.auth?.error && <p className="px-1 text-[13px] text-bad">{have.auth.error}</p>}
      {!have && signIn && !signIn.signIn && <p className="px-1 text-[13px] text-muted">{howToSignIn(name, signIn)}</p>}
      {!have && trust?.kind === "unverified" && registry && <p className="px-1 text-[13px] text-warn">Not verified. Add it only if you trust {registry.publisher}.</p>}
      {error && <p className="px-1 text-[13px] text-bad">{error}</p>}

      <Rows>
        {have && <FactRow label="Who can use it" value={whoLine(have, agents)} onClick={canEdit ? () => setWho(true) : undefined} />}
        <FactRow label="Can" value={can} />
        {!have && registry && registry.installs.length > 1 && (
          <Menu align="right" items={registry.installs.map((x, j) => ({ label: x.label, onSelect: () => setPick(j) }))} trigger={(open, toggle) => <FactRow label="Connect with" value={install?.label} onClick={toggle} open={open} />} />
        )}
        {!have && canEdit && signIn?.signIn && onUseKey && <FactRow label="Use a key instead" onClick={onUseKey} />}
        {have && (canEdit ? <Menu align="right" items={account} trigger={(open, toggle) => <FactRow label={accountLabel} value={accountValue} need={lapsed} onClick={toggle} open={open} />} /> : <FactRow label={accountLabel} value={accountValue} need={lapsed} />)}
        <FactRow label="More" onClick={() => setMore(!more)} open={more} />
      </Rows>

      {more && (
        <div className="space-y-2 px-1 text-[14px] leading-[22px] text-muted">
          {description && <p className="text-ink/90">{description}</p>}
          {trust && (
            <p>
              <TrustPill t={trust} />
            </p>
          )}
          {summary && <p>{summary.runBy}</p>}
          {have && where && have.kind !== "secret" && <p className="break-all font-mono text-[13px]">{where}</p>}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-ink">
              {registry?.website ? "Website" : "More about it"} <ExternalLink size={13} aria-hidden />
            </a>
          )}
        </div>
      )}

      {canEdit && have && (
        <div className="pt-3">
          <RemoveBtn onClick={() => onRemove(have)}>Remove</RemoveBtn>
        </div>
      )}

      {who && have && (
        <WhoCanUse
          agents={agents}
          allAgents={!!have.allAgents}
          agentIds={have.agentIds}
          disabled={!canEdit || busy}
          error={error}
          note={(a) => connectorUnsupportedReason(a.harness, have.kind)}
          onAll={(on) => void change(() => api("PATCH", `/api/connectors/${have.id}`, { allAgents: on }))}
          // the picker hands back the whole list; send only what changed
          onPick={(ids) =>
            void change(async () => {
              for (const id of ids) if (!have.agentIds.includes(id)) await api("PUT", `/api/connectors/${have.id}/agents/${id}`);
              for (const id of have.agentIds) if (!ids.includes(id)) await api("DELETE", `/api/connectors/${have.id}/agents/${id}`);
            })
          }
          onClose={() => setWho(false)}
        />
      )}
    </div>
  );
}

/** Before the browser leaves for an app's sign-in page (Wisp never sees the password); a key instead, where the app takes one. */
export function ConnectSignIn({ connector, onClose, onSignIn, onUseKey }: { connector: { name: string }; onClose: () => void; onSignIn: () => void; onUseKey?: () => void }) {
  return (
    <Dlg title={`Sign in to ${connector.name}`} onClose={onClose}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onUseKey && (
          <button type="button" onClick={onUseKey} className="mr-auto text-sm text-muted hover:text-ink">
            Use a key instead
          </button>
        )}
        <Prim onClick={onSignIn} className="h-11 text-body max-sm:w-full">
          <LogIn size={17} /> Open sign-in
        </Prim>
      </div>
    </Dlg>
  );
}
