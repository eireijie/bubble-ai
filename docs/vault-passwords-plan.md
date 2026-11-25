# Passwords in the vault: plan

Status: first build on branch `claude/vault-passwords-c4dae1`, 2026-11-25 (design for the bubbles redesign approved the same day). See "What was built" at the end for where the build differs from this plan.

The owner's ask: the Wisp server's vault holds agents' memory **and** passwords, kept in "a opensource password manager that runs with the server, kind of like rustdesk". The standing rule still holds: **Wisp itself never stores passwords.** The bundled manager is its own unchanged open-source app with its own database and its own encryption, the person makes the account in it, and Wisp reads one login only when an agent fills it. That's the same as today's 1Password support, except the manager now runs on the person's server.

Code read for this (on `origin/main`; this checkout is 421 commits behind it):

- `apps/hub/src/logins.ts`: `Logins` with a pluggable `LoginSourceOpener`; only `openOnePassword` exists (official `@1password/sdk`, service-account token, "Agents" vault). The token is kept in workspace setting `logins.source`, and "always" grants in `logins.always`. Allowing a login once also lets it fill again for 10 minutes. `request` → approval card → `decide` → `fill`.
- `packages/core/src/logins.ts`: `LoginSourceKind = "1password"`, `siteOf`, `siteMatches` (exact host, `www.` ignored).
- `packages/mcp/src/server.ts`: the agent's `login_fill` tool. The agent hears "filled", never the password.
- `apps/node/src/computers/driver.ts` `fill_login` → `docker.ts` `fillLogin`: pipes `{site, username, password, otp}` over stdin into a script inside the VM. The script fills only when the VM Chrome's front page is on that site over https. Only VMs can fill.
- RustDesk: `apps/desktop/src/rustdesk.cjs` and `apps/node/src/rustdesk.ts`. It's recommended in the start flow, installed as its own unchanged app after asking, and Wisp keeps only its ID. The person sets its password.
- Server: `docker/cloud-init.yaml` writes `/opt/wisp/compose.yaml` (hub, device, Caddy) and `start.sh` (Caddyfile, setup-key guard on `POST /api/setup`). `/etc/cron.daily/wisp-update` pulls images every night.

Today the hub process does see each password in memory for a moment: `secret()` returns it, and `computers.act` relays it to the device. Step 3 below removes that.

---

## 1. Which manager

| | **Vaultwarden** | Passbolt CE | KeePassXC + sync | Bitwarden Lite (official) |
|---|---|---|---|---|
| Licence | AGPL-3.0 | AGPL-3.0 | GPL-3.0 | Mixed: parts under the Bitwarden License, not fully open source |
| What runs on the server | One container (Rust), SQLite in one folder | PHP app + MariaDB/MySQL (2 containers), GPG keys | No server; a `.kdbx` file synced over WebDAV/Nextcloud/Syncthing | One container + a database (MariaDB/Postgres/MSSQL) |
| Footprint | ~20–60 MB RAM idle, small image | Several hundred MB with its database | Nothing on the server beyond the sync | Several hundred MB |
| Docker or binary | Docker image `vaultwarden/server` (no official standalone binary) | Docker or distro packages | Desktop app only | Docker |
| Official Bitwarden apps and browser extensions | **Yes**: iOS, Android, desktop, every browser extension and the `bw` CLI accept a self-hosted server URL | No: Passbolt's own extension and apps | No: KeePassXC desktop + third-party phone apps (KeePassDX, Strongbox) | Yes |
| Headless access for agents | `bw` CLI (`bw serve` gives a local REST API) with an account's API key | Passbolt API with a user's GPG key (go-passbolt-cli) | `keepassxc-cli` with the database password | `bw` CLI |
| One-time codes (TOTP) | Yes, free (Bitwarden charges for it) | Yes (newer versions) | Yes | Paid tier |

**Recommendation: Vaultwarden.** It's the only choice that is fully open source, tiny enough for the 4 GB server next to the hub and an agent computer, and works with the official Bitwarden apps people already know. So the person gets real phone, desktop and browser autofill for their own use, not just a store for agents. Passbolt is heavier and team-shaped, KeePassXC has no server and weak phone support, and Bitwarden's own self-host isn't fully open source.

Things to check before building:

- New Bitwarden client releases sometimes need a newer Vaultwarden. Keep Vaultwarden on the nightly update, same as the hub.
- Vaultwarden is an unofficial reimplementation. Bitwarden doesn't support it, and the owner should be comfortable with that.
- Vaultwarden has no Secrets Manager or "machine account" support. Headless access therefore goes through a normal user account's API key (see §3).

People who already use 1Password or Bitwarden cloud keep that. The bundled vault is a third choice in **Settings → Logins**, offered by default when nothing is connected.

## 2. How Wisp installs it

**The RustDesk pattern:** an optional companion, recommended in the start flow, run as its own unchanged app, set up by Wisp after asking. Its secret belongs to the person.

### Set up, start and update with the hub

- **New servers (cloud-init):** add a `vault` service to `/opt/wisp/compose.yaml`:
  - `image: vaultwarden/server:latest`, `restart: unless-stopped`, data in `/opt/wisp/vault`.
  - On the compose network only, with no published port.
  - Env: `DOMAIN=https://<ip>/vault`, `SIGNUPS_ALLOWED=true` (closed after the first account, see below), `INVITATIONS_ALLOWED=true`, no `ADMIN_TOKEN` (so its admin page is off), `WEBSOCKET_ENABLED=true`, `LOGIN_RATELIMIT_*` at defaults.
  - Put it under a compose profile `vault`, so `start.sh` turns it on with `COMPOSE_PROFILES=vault` in `.env` only when the person said yes in the start flow.
- **Caddy:** `start.sh` adds `handle /vault/* { reverse_proxy vault:80 }` to the `(wisp)` snippet. Same certificate and address as Wisp. No path stripping, because `DOMAIN` carries the `/vault` path. Bitwarden apps take `https://<ip>/vault` as their server URL.
- **Updates:** `/etc/cron.daily/wisp-update` already runs `docker compose pull && up -d`, so Vaultwarden updates with the hub with no new code.
- **Servers that already exist:** their compose file and Caddyfile were written once by cloud-init, and the device container can't reach them. Ship a `/opt/wisp/vault.sh` in the hub image and show a one-line SSH command on the vault's settings page. It turns the profile on, adds the Caddy route and restarts. A self-updating `start.sh` that rewrites compose from the image is the better long-term fix. Decide it as part of this work.
- **Self-host on a Mac or PC (desktop start flow):** Vaultwarden needs Docker. Offer it only when Docker is present and the device runs it as a container next to the hub. Otherwise Settings → Logins offers 1Password or Bitwarden cloud.

### First account: made by the person, never by Wisp

1. After "Start Wisp" finishes, the start flow shows one optional step, **"Keep passwords on your Wisp"**. Like RustDesk, it can be skipped.
2. It opens the vault's own sign-up page (`https://<ip>/vault/#/register`) in the setup window or the browser. The person picks the email and master password there. Wisp never sees the form, and the page is Vaultwarden's own web vault.
3. Account creation is guarded the same way as Wisp's first account: Caddy refuses Vaultwarden's register endpoint unless the request carries the setup key, until the first account exists. The person's browser gets the key from the setup window's link, and the key is used only once.
4. Once the first account exists, `SIGNUPS_ALLOWED=false`. The hub can tell an account exists because register starts returning "taken". `start.sh`/`vault.sh` writes the flag and restarts the container. After that, new accounts come only by invitation from inside the vault.
5. Wisp then shows: install Bitwarden on your phone and browser, server `https://<ip>/vault`. It shows a QR code for the phone, and the person turns on two-factor sign-in in the vault.

### Backups

- Vaultwarden keeps everything in `/opt/wisp/vault`: `db.sqlite3`, `rsa_key*`, attachments and sends. The vault is end-to-end encrypted, so a copy is useless without the master password and can safely leave the server.
- A nightly `sqlite3 db.sqlite3 ".backup"` plus the key files, as a dated tarball in `/opt/wisp/backups/vault`, keeping 14 days. This goes in the same daily cron, before the pull.
- Optional off-server copy through the Storage mod (WebDAV/Drive/Dropbox) when it's added. Off by default.
- Every Bitwarden app also keeps an offline encrypted copy, and the vault's own **Export** (encrypted JSON) is the person's escape hatch. The vault settings page says both in one line.
- `deploy.md`'s "Back up `/opt/wisp/data` and `/opt/wisp/device` first" gains `/opt/wisp/vault`.

## 3. How agents use it

The agent-facing side doesn't change: `login_fill(site, account?)`, the approval card (Allow once / Always / No), the exact-site check, "filled" back to the agent, and `computer_ask_human` when there's no login.

### Which logins agents can see

- In the vault, the person makes an **organization "Agents"** with one collection. This is free and unlimited on Vaultwarden. Logins agents may use go in that collection, and everything else in the person's vault stays out of reach.
- Agents get their own vault account (e.g. `agents@<server>`), invited to that organization and limited to that collection. Wisp guides this, but the person does it in the vault: Wisp shows the steps and opens the right pages. This mirrors today's 1Password rule ("a service account that can see only the Agents vault").

### The bridge: a new small sidecar `vault-bridge`

- It's the official Bitwarden CLI (`bw`, GPL-3.0) running `bw serve` on the compose network, with a thin Wisp wrapper. Its image is built in this repo.
- The person connects it once from **Settings → Logins → Wisp vault**. The bridge serves its own small page (through Caddy) where they enter the agents account's API key and master password. The hub never receives them. The bridge keeps them in its own volume (mode 600, not in the hub's database) and unlocks `bw`.
- **Advanced toggle "Lock when the server restarts":** with it on, the bridge keeps nothing on disk. After a restart, `login_fill` gets "vault locked" and the person gets a card to unlock it again. The default is off, so agents keep working on their own.

### The fill path: the password never passes through the hub

1. The hub's `Logins` gets a second source, `openWispVault`. Its `list()` calls the bridge's `GET /items?collection=Agents` and maps the results to `{id, title, site, username}`. The bridge strips secrets before answering.
2. After approval, the hub asks the bridge for a **one-time fill ticket** for `{itemId, site, computerId}` (single use, 60 s). The hub relays only the ticket through `computers.act({action: "fill_login", ticket})`.
3. The device redeems the ticket with the bridge directly: over `127.0.0.1` on the server, or over `https://<wisp>/vault-bridge/redeem` for a VM on another device, authenticated with the device's existing token. It gets `{username, password, otp}` and pipes them into the VM's fill script exactly as today. The bridge checks again that the ticket's site matches the item.
4. The same ticket split works for 1Password later: move `secret()` into the device. For now that path is unchanged.

So the hub stores only the source kind, the vault name and the "always" grants. The password exists only in the bridge (the manager's own client), in the device's memory for the length of one fill, and in the VM's page. Wisp writes it nowhere and logs nothing about it.

**Strict alternative, not recommended for v1:** have the Bitwarden browser extension itself fill inside the VM's Chrome (logged in as the agents account; Wisp presses its autofill shortcut), so no Wisp code touches the password at all. But an agent that controls that browser could open the extension and read every agent login. That's worse than the bridge, which hands over one login at a time after approval.

`LoginSourceKind` becomes `"1password" | "wisp-vault"`, with the label "Wisp vault". Bitwarden cloud (`bw` pointed at bitwarden.com) also comes almost for free from the same bridge as `"bitwarden"`. That closes the "Not done: Bitwarden" item from the original logins work.

## 4. Security

**Who can unlock what**

| Who | Can open |
|---|---|
| The person | Their own vault: everything, with their master password and 2FA. Wisp never has it. |
| The bridge | Only the Agents collection, with the agents account's API key and master password, which the person enters on the bridge's page |
| The hub | Nothing: item titles, sites and usernames only, plus fill tickets |
| Agents | Nothing directly: they ask `login_fill` for one site and hear "filled" |
| Other members of a shared Wisp | Can't approve: only the person who connected the vault (`ownerId`) answers login cards, as today |

**Per-agent access**

- Today's per-agent "Always" list (`logins.always`) and the 10-minute pass after "Allow once" stay.
- Add an optional per-login agent list in Settings → Logins ("Only Ava and Ben can ask for this"), so other agents get a plain "no saved login" without a card.
- Later, if wanted, map vault collections to teams (an "Agents/Support" collection → the Support team). Not in v1.

**Approval prompts**

- They're unchanged, and they need to show on iPhone and Android as the proper login card, which is still a generic approval there (a gap from the original work).
- Add a line to the card when the login has a one-time code ("This also fills the 2FA code"), and add a vault "Recent fills" log from `computers.log`.

**Threats and answers**

- **Prompt-injected agent fills on a lookalike site:** exact host match + https in the VM (already built), checked again by the bridge on redeem. Subdomains of shared hosts never match.
- **Agent reads a password after it's filled:** an agent inside its VM has a terminal and the browser's debugging port, so it *can* read a filled field. This exists today with 1Password too. Mitigations: fill, submit, then clear the field; the tool text tells agents not to read it; logins with "always" stay per agent. Say this plainly in the vault's settings: **give agents only logins you'd hand an assistant.**
- **Agents running directly on the server's device (not in a VM):** the device has the Docker socket, so those agents control the server (already noted in `deploy.md`). They could read the bridge's stored unlock. Mitigations: recommend the "Lock when the server restarts" toggle on such servers; show a warning on the vault settings page when any agent runs outside a VM on the server; the person's own vault is still safe, because only the Agents collection is unlocked there.
- **Server stolen or broken into:** the vault data is end-to-end encrypted (Argon2id by default for new Bitwarden accounts), so the person's vault holds. The Agents collection is exposed unless the bridge locks on restart, the same as a stolen 1Password service-account token today.
- **Brute force on the public vault login:** Vaultwarden's built-in login rate limit, admin page off (no `ADMIN_TOKEN`), signups closed after the first account, and 2FA prompted at setup. Optionally, Caddy returns 404 for `/vault/admin*`.
- **Hub bug or log leak:** the hub never holds a password or the bridge unlock (§3). Add a test that greps hub logs and stored settings for the test password.
- **Backups leaking:** they're encrypted vault files, but tarballs stay mode 600, and off-server copies are opt-in.
- **Updates breaking clients or the bridge:** nightly pull for both. The bridge is pinned to a `bw` version shipped with Wisp releases and has a health check; a failing bridge answers "vault unavailable", so agents fall back to `computer_ask_human`.

## 5. Steps to build

| # | Step | Where | Size |
|---|---|---|---|
| 0 | Mockup in Claude Design: the start-flow step, Settings → Logins with "Wisp vault", the bridge connect page, the warning on servers with agents outside VMs. Owner approves first. | design | S |
| 1 | `vault` service in cloud-init compose (profile), Caddy `/vault/*` route, register guard with the setup key, signups closed after the first account, nightly backup in the cron; `vault.sh` for existing servers | `docker/cloud-init.yaml`, new `docker/vault.sh` | M |
| 2 | Start-flow step "Keep passwords on your Wisp" (optional, like RustDesk), opening the vault's sign-up page, then the "get Bitwarden" QR and server URL | `apps/desktop` start flow, web | M |
| 3 | `vault-bridge` image: `bw serve` + a small wrapper (connect page, list without secrets, one-time tickets, redeem with site check, lock on restart option, health) | new `docker/vault-bridge/`, compose | M–L |
| 4 | Hub: `openWispVault` source, `LoginSourceKind` + label, a ticket-based fill in `Logins.fill`, per-login agent list | `apps/hub/src/logins.ts`, `api-logins.ts`, `packages/core/src/logins.ts` | M |
| 5 | Device: `fill_login` accepts a ticket and redeems it with the bridge (localhost on the server, HTTPS elsewhere), then the same VM fill script | `apps/node/src/computers/driver.ts`, `docker.ts` | S–M |
| 6 | Settings → Logins on web, desktop, iPhone and Android: the Wisp vault choice, status (locked/unlocked, item count), recent fills, the warning; the proper login card on iPhone/Android | `apps/web`, `apps/ios/Wisp/LoginsView.swift`, `apps/android` | M–L |
| 7 | Optional: Bitwarden cloud as a source through the same bridge | bridge config + label | S |
| 8 | Tests and live proof: unit tests for tickets and site checks; a test that no password reaches hub settings or logs; a real server run (paid server test) with the official Bitwarden iOS app and browser extension signed in to `https://<ip>/vault`; a real agent filling a test site; a backup restore drill | `apps/hub/test`, `apps/node/test`, live | M |
| 9 | Docs: `deploy.md` section next to RustDesk, `/opt/wisp/vault` in the backup line | `docs/deploy.md` | S |

Rough total: about 2–3 focused weeks of agent work, with the bridge (step 3) and the four-client settings (step 6) as the big pieces. Steps 1–2 and 3–5 can run in parallel after the design is approved.

**Open questions for the owner**

1. OK with Vaultwarden being an unofficial Bitwarden server?
2. Should "Lock when the server restarts" be off (agents keep working) or on (safer) by default?
3. Should existing servers get the vault through a one-line SSH command now, or wait for a self-updating `start.sh`?
4. The guided org + agents-account setup is about five steps in the vault's own pages. Is that acceptable, or should Wisp aim for one screen even if it means more Wisp code near the vault?

---

## What was built (2026-11-25)

Built: steps 1 (as `docker/vault.sh`), 3, 4, 5, a web-only part of 6 (Settings → Memory vault at `#/settings/vault`, and a Wisp vault row in Settings → Logins), 8 (unit tests and a local live run) and 9.

Where the build differs from the plan, the safer choice was taken:

- **The device redeems with its own token.** The bridge has two tokens: the hub's (status, list without secrets, tickets) and the device's (redeem). The hub holds tickets but can't redeem them, so a hub bug or a leaked ticket opens nothing. Tickets are bound to one login, one site and one computer, single use, 60 s, and the bridge checks the login is still in Agents and saved for that site on redeem.
- **Only the server's own device fills from the Wisp vault.** Devices elsewhere don't get the redeem token (they'd need the hub to hand it out, which undoes the point). 1Password still fills on any device's VMs.
- **"Agents" can be a collection or a folder.** A dedicated agents account sees only what's shared with it anyway; the folder option skips the organization step for people who don't want one. Logins outside it are never listed or handed out.
- **Connecting the agents' account** uses the bridge's own page (`/vault-bridge/connect`, served by the bridge through Caddy) with a single-use code from Wisp (10 minutes, 3 tries). Email + master password, or API key + master password.
- **"Lock when the server restarts" is off by default** (agents keep working), a checkbox on the connect page. With it off, the bridge keeps the agents account's unlock in its own volume, mode 600.
- **One mechanism for new and older servers.** Instead of changing cloud-init's compose file, `docker/vault.sh` (shipped in the hub image) writes `compose.override.yaml` and `vault.caddy` (imported into the Caddyfile), so it works the same everywhere and cloud-init stays as it was. The vault is **off until the owner runs it**; Settings → Memory vault shows the one-line command. The start-flow step (step 2) isn't built.
- **The sign-up guard** is a cookie from a setup link that `vault.sh` prints (the cookie lasts an hour; the key rotates when sign-ups close) (not the Wisp setup key, which an older server may not have). Caddy refuses Vaultwarden's register endpoints without it, hides `/vault/admin`, and an hourly cron closes sign-ups once the first account exists (`sqlite3` on the host).
- **The Storage mod can't use Wisp vault logins**: it would need the password in the hub. It says so.
- **The bridge image** is built from `docker/vault-bridge/` by a second job in `hub-image.yml` as `ghcr.io/<owner>/wisp-vault-bridge`, with `bw` pinned at 2026.11.1.

- **The vault has its own address**, `https://vault.<ip-dashed>.sslip.io`, not `https://<ip>/vault`: on Wisp's own origin, any script running in the Wisp web app (an injected agent message, say) could open the vault's pages and read the person's master password as they type it. The bridge's connect page lives there too. The Bitwarden CLI only talks HTTPS, so the bridge reaches the vault through Caddy at that address as well.
- **Vault controls are for the hub's owner only** (`hubOwner`), not any workspace's owner: the vault is the server's, and a second workspace's owner mustn't be able to point their agents at it.
- **The device takes the redeem token out of its environment** at start, so harnesses, terminals and VMs it spawns don't inherit it. The setup key rotates when sign-ups close; `vault.sh` writes everything under `umask 077`.

Security review (2026-11-25), what's left and why:

- **Anything running directly on the server's device** (an agent outside a VM, a Code-mod terminal) has the Docker socket, so it can `docker inspect` the bridge or read its saved unlock and use every Agents login without approval. That's true of everything on that server already (deploy.md says the device controls the server). Mitigations today: the "Lock when the server restarts" option and the docs. Owner decision: refuse vault fills while any agent on the server runs outside a VM, and/or default the lock on.
- **The agent controls its own VM's browser**, so it can read a field after a fill (true of 1Password fills today). The fill clears the password when sign-in doesn't move on; the tool text says not to read it. A stricter design (the person approves on the bridge, or the fill happens in a browser profile the agent can't script) is future work.
- **A compromised hub** can mint tickets without asking the person (approval is enforced in the hub). The split still keeps passwords out of the hub's memory, database and logs.
- **The agents account's master password is kept on disk** (bridge volume, mode 600) unless "Lock when the server restarts" is ticked. Default left off, as the plan says; owner decision.
- **`vault.sh` comes from the hub image** and runs as root (plus its cron jobs). The same image already runs as the device with the Docker socket, so this adds no new trust; shipping it pinned from a release would be tidier.

Not built yet: the start-flow step, Settings on iPhone/Android, the proper login card on phones, the per-login agent list, the "This also fills the 2FA code" line on the card, a "Recent fills" log, the warning for agents running outside a VM on the server, Bitwarden cloud as a source, and a paid-server run with the official Bitwarden apps.
