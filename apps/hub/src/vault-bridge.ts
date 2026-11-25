import { siteOf } from "@wisp/core";
import { LoginError, type LoginSource } from "./logins.ts";

/**
 * The hub's side of the Wisp vault: talks to the vault-bridge sidecar (docker/vault-bridge), which
 * runs the official Bitwarden CLI against the Vaultwarden on this server. The hub only ever gets
 * logins without their secrets, and single-use fill tickets it can't redeem itself (redeeming needs
 * the device's own token). See docs/vault-passwords-plan.md.
 */

export interface VaultBridgeConfig {
  /** where the hub reaches the bridge, e.g. http://vault-bridge:8088 */
  url: string;
  /** the bridge's hub token (not the redeem token) */
  token: string;
  /** the vault people open in a browser and the Bitwarden apps, e.g. https://203.0.113.7/vault */
  vaultUrl: string | null;
  /** the bridge's connect page as people reach it, e.g. /vault-bridge/connect */
  connectUrl: string;
}

export interface VaultBridgeStatus {
  state: "not_connected" | "locked" | "ready" | "unavailable";
  account: string | null;
  lockOnRestart: boolean;
  problem: string | null;
}

export function vaultBridgeConfig(env: NodeJS.ProcessEnv = process.env): VaultBridgeConfig | null {
  const url = env.WISP_VAULT_BRIDGE_URL?.trim();
  const token = env.WISP_VAULT_BRIDGE_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token, vaultUrl: env.WISP_VAULT_URL?.trim() || null, connectUrl: env.WISP_VAULT_CONNECT_URL?.trim() || "/vault-bridge/connect" };
}

export class VaultBridge {
  constructor(readonly config: VaultBridgeConfig) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.config.url + path, {
        method,
        headers: { authorization: `Bearer ${this.config.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new LoginError("The Wisp vault isn't answering. Use computer_ask_human so the person signs in themselves.", 503);
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new LoginError(data.error ?? `the Wisp vault answered ${res.status}`, res.status === 423 ? 412 : res.status >= 500 ? 503 : res.status);
    return data;
  }

  async status(): Promise<VaultBridgeStatus> {
    try {
      return await this.call<VaultBridgeStatus>("GET", "/v1/status");
    } catch (err) {
      return { state: "unavailable", account: null, lockOnRestart: false, problem: (err as Error).message };
    }
  }

  /** A link to the bridge's own page, where the person signs the agents' account in. */
  async connectLink(): Promise<{ url: string; expiresAt: string }> {
    const { code, expiresAt } = await this.call<{ code: string; expiresAt: string }>("POST", "/v1/connect-codes");
    return { url: `${this.config.connectUrl}#${code}`, expiresAt };
  }

  forget() {
    return this.call<{ ok: true }>("POST", "/v1/forget");
  }

  async items(fresh = false) {
    const r = await this.call<{ logins: { id: string; title: string; site: string; username: string; hasOtp: boolean }[] }>("GET", `/v1/items${fresh ? "?fresh=1" : ""}`);
    // only what the hub may know, whatever the bridge sent
    return r.logins.flatMap((l) => {
      const site = siteOf(String(l.site));
      return site ? [{ id: String(l.id), title: String(l.title), site, username: String(l.username ?? ""), hasOtp: !!l.hasOtp }] : [];
    });
  }

  async ticket(itemId: string, site: string, computerId: string): Promise<string> {
    return (await this.call<{ ticket: string }>("POST", "/v1/tickets", { itemId, site, computerId })).ticket;
  }
}

/** The Wisp vault as a login source: lists logins and hands out fill tickets, never secrets. */
export async function openWispVault(bridge: VaultBridge | null): Promise<LoginSource> {
  if (!bridge) throw new LoginError("This Wisp doesn't run a vault. Turn it on on the server first (Settings → Memory vault).", 412);
  const s = await bridge.status();
  if (s.state !== "ready") throw new LoginError(s.state === "unavailable" ? (s.problem ?? "The Wisp vault isn't answering.") : s.state === "locked" ? "The Wisp vault is locked. Connect the agents' account again in Settings → Memory vault." : "Connect the agents' vault account first (Settings → Memory vault).", 412);
  return {
    vaultName: "Agents",
    list: () => bridge.items(),
    ticket: (itemId, site, computerId) => bridge.ticket(itemId, site, computerId),
  };
}
