import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chatgptAccount, type ConnectionSecret, type NodeToHub } from "@bubble-ai/core";

/** Where Codex keeps this device's own sign-in. */
export function codexAuthFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json");
}

type Auth = Record<string, any>;

function readAuth(file: string): Auth | null {
  try {
    const auth = JSON.parse(fs.readFileSync(file, "utf8"));
    return auth && typeof auth === "object" ? auth : null;
  } catch {
    return null;
  }
}

const refreshedAt = (a: Auth | null | undefined) => {
  const t = Date.parse(String(a?.last_refresh ?? ""));
  return Number.isFinite(t) ? t : 0;
};
const accountOf = (a: Auth | null | undefined) => (typeof a?.tokens?.account_id === "string" ? a.tokens.account_id : null);

/** "Use this sign-in": this device's Codex sign-in, for the hub to keep. Throws when there isn't one. */
export function importCodexSignin(file = codexAuthFile()): { secret: ConnectionSecret; account?: string | null; plan?: string | null } {
  const auth = readAuth(file);
  if (!auth) throw new Error("Codex isn't signed in on this computer");
  if (!auth.tokens?.refresh_token) throw new Error("Codex here uses an API key, not a ChatGPT sign-in");
  return { secret: { auth }, ...chatgptAccount(auth) };
}

/**
 * Keeps this device's own Codex sign-in and the hub's copy of it in step, for connections made
 * with "Use this sign-in". Codex renews a ChatGPT sign-in by replacing its refresh token, and the
 * old one stops working at once, so whichever side renewed last hands its copy to the other:
 * newer here goes to the hub, newer on the hub is written here. Only the same ChatGPT account is
 * ever written (a person who signed in to another account here keeps it). Exported for tests.
 */
export class SharedSignins {
  private links: { connectionId: string; secret: ConnectionSecret }[] = [];
  private watching = false;
  private sentAt = 0;

  constructor(
    private send: (m: NodeToHub) => void,
    private log: (s: string) => void = () => {},
    readonly file = codexAuthFile(),
    private watchEveryMs = 15_000,
  ) {}

  /** The hub's list (on connect and after each change). */
  update(signins: { connectionId: string; secret: ConnectionSecret }[]) {
    this.links = signins.filter((s) => s.secret.auth);
    this.sync();
    if (this.links.length && !this.watching) {
      fs.watchFile(this.file, { interval: this.watchEveryMs, persistent: false }, () => this.sync());
      this.watching = true;
    } else if (!this.links.length && this.watching) this.stop();
  }

  stop() {
    fs.unwatchFile(this.file);
    this.watching = false;
  }

  /** Compare each shared connection with the sign-in here and pass on the newer one. */
  sync() {
    const here = readAuth(this.file);
    for (const link of this.links) {
      const hub = link.secret.auth as Auth;
      if (!here) continue;
      // another account signed in here since: leave both alone
      if (accountOf(here) && accountOf(hub) && accountOf(here) !== accountOf(hub)) continue;
      const ours = refreshedAt(here);
      const theirs = refreshedAt(hub);
      if (ours > theirs && here.tokens?.refresh_token && here.tokens.refresh_token !== hub.tokens?.refresh_token) {
        if (ours <= this.sentAt) continue;
        this.sentAt = ours;
        link.secret = { ...link.secret, auth: here };
        this.send({ type: "shared_signin_renewed", connectionId: link.connectionId, secret: { auth: here } });
        this.log("Codex renewed its sign-in here; sent it to the hub");
      } else if (theirs > ours && hub.tokens?.refresh_token) {
        this.write(hub);
        this.log("an agent renewed the shared Codex sign-in; saved it here too");
      }
    }
  }

  private write(auth: Auth) {
    const tmp = `${this.file}.wisp-${process.pid}`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(auth, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
