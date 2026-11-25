import { ActionError } from "./driver.ts";

/**
 * Read once and taken out of the environment, so harnesses, terminals and VMs this device starts
 * (which inherit its environment) never get the token that redeems fill tickets.
 */
const CONFIG: { url?: string; token?: string } = {};
function config() {
  if (process.env.WISP_VAULT_REDEEM_TOKEN) {
    CONFIG.url = process.env.WISP_VAULT_BRIDGE_URL;
    CONFIG.token = process.env.WISP_VAULT_REDEEM_TOKEN;
    delete process.env.WISP_VAULT_REDEEM_TOKEN;
  }
  return CONFIG;
}
config();

/**
 * The Wisp vault's last step: the hub sends a single-use fill ticket instead of a login, and this
 * device redeems it with the vault bridge itself (with its own redeem token, which the hub doesn't
 * have), so the password only ever exists here for the one fill and in the VM's page.
 *
 * On a Wisp server the bridge is beside this device: WISP_VAULT_BRIDGE_URL=http://127.0.0.1:8088.
 */
export async function redeemFillTicket(ticket: string, site: string, computerId: string, env: { url?: string; token?: string } = config()): Promise<{ username: string; password: string; otp?: string }> {
  const url = env.url?.trim().replace(/\/+$/, "");
  const token = env.token?.trim();
  if (!url || !token) throw new ActionError("this device can't fill logins from the Wisp vault: only the server's own device can");
  let res: Response;
  try {
    res = await fetch(`${url}/v1/redeem`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ticket, site, computerId }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ActionError("the Wisp vault isn't answering");
  }
  const data = (await res.json().catch(() => ({}))) as { username?: unknown; password?: unknown; otp?: unknown; error?: unknown };
  if (!res.ok) throw new ActionError(typeof data.error === "string" ? data.error : `the Wisp vault answered ${res.status}`);
  if (typeof data.username !== "string" || typeof data.password !== "string") throw new ActionError("the Wisp vault sent back something unexpected");
  return { username: data.username, password: data.password, ...(typeof data.otp === "string" && data.otp ? { otp: data.otp } : {}) };
}
