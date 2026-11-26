import { useEffect, useState } from "react";
import { Monitor, Plus } from "lucide-react";
import { api } from "../../api.ts";
import { useAccess, useAccessStore, type AccessInfo } from "../../access.ts";
import { canApproveJoin, loadMcpClients, unavailable, type McpClient } from "../../join.ts";
import { useStore } from "../../store.ts";
import { useDevices } from "../../devices.ts";
import { useComputerMode } from "../../computerMode.ts";
import { href } from "../../router.ts";
import { AddDeviceDialog } from "../../components/AddDevice.tsx";
import { AwayFromHome, awayEnabled, connectorBlocker, connectorOrigin, enableTailscale } from "../../components/Access.tsx";
import { Button, CopyBlock } from "../../components/ui.tsx";
import { Row, Toggle } from "./parts.tsx";
import { Group, SRow, rowDomId } from "./rows.tsx";

/** Every device in this Bubble AI, one line each, and Add a device. */
export function DevicesRows() {
  const devices = useDevices(3000);
  const allowed = useStore((s) => canApproveJoin(s.me?.role));
  const [adding, setAdding] = useState(false);
  return (
    <div id={rowDomId("devices")}>
      <Group>
        {devices?.map((device) => (
          <a key={device.id} href={href({ view: "computers", computerId: null, deviceId: device.id })} className="flex items-center gap-3 px-4 min-h-[52px] text-body hover:bg-hover">
            <Monitor size={18} className="text-muted shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{device.name}</span>
            <span className="shrink-0 text-[13px] text-muted">
              {device.paused ? "Paused" : device.online ? "Connected" : "Offline"}
              {!device.mine && device.ownerName ? ` · ${device.ownerName}` : ""}
            </span>
          </a>
        ))}
        {allowed && (
          <button type="button" onClick={() => setAdding(true)} className="w-full flex items-center gap-3 px-4 min-h-[52px] text-body text-left hover:bg-hover">
            <Plus size={18} className="text-muted shrink-0" aria-hidden />
            Add a device
          </button>
        )}
      </Group>
      {adding && <AddDeviceDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Away from home: the row says how it's on, the switch turns it off or opens the setup under it. `expanded` opens the setup straight away (the old Away from home page). */
export function AwayRow({ expanded = false }: { expanded?: boolean }) {
  const info = useAccess(3000);
  const failed = useAccessStore((s) => s.failed);
  const allowed = useStore((s) => canApproveJoin(s.me?.role));
  const [setupAway, setSetupAway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = awayEnabled(info);
  const cloudflare = info?.cloudflare?.state === "running";
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(unavailable(e, "Away from home"));
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    if (cloudflare) {
      await api("POST", "/api/reach/cloudflare", { action: "stop" });
      await useAccessStore.getState().refresh(true);
    } else if (info?.tailscale.serving) {
      if (info.tailscale.funnel) await useAccessStore.getState().act("unfunnel");
      await useAccessStore.getState().act("unserve");
    } else throw new Error("This Bubble AI already uses a public address.");
  };
  return (
    <>
      <SRow id="away" value={on ? (cloudflare ? "Cloudflare" : info?.tailscale.serving ? "Tailscale" : "Public address") : !info && failed ? "Not available" : "Off"}>
        <Toggle label="Away from home" on={on} disabled={!allowed || busy} onChange={(value) => (value ? setSetupAway(true) : void run(turnOff))} />
      </SRow>
      {(setupAway || expanded) && (
        <div className="px-4 py-4">
          <AwayFromHome onDone={() => setSetupAway(false)} />
        </div>
      )}
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-bad">
          {error}
        </p>
      )}
    </>
  );
}

/** Whether the owner picks where each agent runs (Advanced), or Bubble AI places them. The switch other pages read. */
export function PickSwitch() {
  const mode = useComputerMode();
  const owner = useStore((s) => s.me?.role === "owner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && (
        <span role="alert" className="text-[13px] text-bad">
          {error}
        </span>
      )}
      <Toggle
        label="Pick each agent's computer"
        on={mode.advanced}
        disabled={!owner || !mode.loaded || busy}
        onChange={(value) => {
          setBusy(true);
          setError(null);
          mode
            .setAdvanced(value)
            .catch((e) => setError((e as Error).message))
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

/** What the Outside apps row says: how many apps are connected. */
export function McpValue() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    loadMcpClients().then((list) => setN(list?.length ?? null), () => {});
  }, []);
  return <>{n === null ? "" : n === 0 ? "None" : `${n} connected`}</>;
}

/** Outside apps: the public address Grok, ChatGPT and Claude connect to, and the apps that did. */
export function OutsideApps() {
  const info = useAccess(3000);
  const allowed = useStore((s) => canApproveJoin(s.me?.role));
  return <McpConnections info={info} allowed={allowed} />;
}

export function McpConnections({ info, allowed }: { info: AccessInfo | null; allowed: boolean }) {
  const origin = connectorOrigin(info);
  const owner = useStore((s) => s.me?.role === "owner");
  const [clients, setClients] = useState<McpClient[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setClients(null);
    if (!allowed) return;
    let alive = true;
    const load = () =>
      loadMcpClients().then(
        (list) => {
          if (alive) {
            setClients(list);
            setError(null);
          }
        },
        (e) => {
          if (alive) setError(unavailable(e, "Connected apps"));
        },
      );
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [allowed]);
  const toggle = async (on: boolean) => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      if (on) {
        const ready = await enableTailscale(true);
        if (!ready) setHint("Finish setting up Tailscale, then turn this on again.");
      } else if (info?.tailscale.connectors) await useAccessStore.getState().act("unconnectors");
      else if (info?.tailscale.funnel) await useAccessStore.getState().act("unfunnel");
      else if (info?.cloudflare?.state === "running") {
        await api("POST", "/api/reach/cloudflare", { action: "stop" });
        await useAccessStore.getState().refresh(true);
      } else throw new Error("This Bubble AI uses a public address; disconnect apps below to remove their access.");
    } catch (e) {
      setError(unavailable(e, "Connected apps"));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async (client: McpClient) => {
    setBusy(true);
    setError(null);
    try {
      await api("DELETE", `/api/mcp/clients/${encodeURIComponent(client.id)}`);
      setClients((list) => list?.filter((c) => c.id !== client.id) ?? null);
    } catch (e) {
      setError(unavailable(e, "Connected apps"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-[14px] bg-card pb-3">
      <Row label="Grok, ChatGPT and Claude">
        <Toggle label="Grok, ChatGPT and Claude" on={!!origin || confirming} disabled={!owner || busy} onChange={(value) => (value ? setConfirming(true) : confirming ? setConfirming(false) : void toggle(false))} />
      </Row>
      <div className="px-4 space-y-3">
        {origin && (
          <>
            <CopyBlock text={`${origin}/mcp`} />
            {info?.connectorUrl && origin === new URL(info.connectorUrl).origin && <p className="text-xs text-muted">Approve it on a device with Tailscale on.</p>}
          </>
        )}
        {!origin && !confirming && connectorBlocker(info) && <p className="text-sm text-muted">{connectorBlocker(info)}</p>}
        {confirming && (
          <div role="alertdialog" aria-label="Turn on a public address" className="space-y-3">
            <p className="text-sm">Anyone can reach this address; only approved apps can use it.</p>
            <div className="flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void toggle(true)}>
                Turn on
              </Button>
              <Button disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {clients !== null && clients.length > 0 && (
          <div className="pt-1">
            <h3 className="text-xs font-medium text-muted mb-1">Connected apps</h3>
            <div className="divide-y divide-line">
              {clients.map((client) => (
                <div key={client.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm min-w-0">
                    <span className="font-medium">{client.name}</span>
                    {client.agentName && <span className="text-muted"> acts as {client.agentName}</span>}
                  </span>
                  <Button disabled={busy} onClick={() => void disconnect(client)}>
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {hint && (
        <p role="status" className="px-4 mt-3 text-sm text-muted">
          {hint}
        </p>
      )}
      {hint && info && (
        <a href={info.tailscale.authUrl ?? info.download} target="_blank" rel="noreferrer" className="inline-block px-4 mt-3 text-sm underline">
          {info.tailscale.state === "missing" ? "Install Tailscale" : "Open Tailscale sign-in"}
        </a>
      )}
      {error && (
        <p role="alert" className="px-4 mt-3 text-sm text-bad">
          {error}
        </p>
      )}
    </section>
  );
}
