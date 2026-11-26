# Signing in to connected apps

Most connected apps used to need a pasted key. These now connect with one sign-in instead, and the key stays as the fallback:

| App | How it signs in | What Bubble AI asks for | Needs an app from Bubble AI's owner |
| --- | --- | --- | --- |
| Notion | Notion's own MCP sign-in | Notion offers no read-only choice: agents can read and edit the pages picked on Notion's page | No |
| Linear | Linear's own MCP sign-in | `read` | No |
| Vercel | Vercel's own MCP sign-in | Vercel's default | No. Works only when Bubble AI is open at localhost (see below) |
| GitHub | Bubble AI's GitHub app, through the relay | `repo read:org read:user notifications`, with GitHub's MCP server in read-only mode (`X-MCP-Readonly`) | Yes |
| Slack | Bubble AI's Slack app, through the relay | Read-only user scopes: history, read and search for channels, private channels, DMs and group DMs; users; files; canvases. No `chat:write` | Yes |
| Gmail | Bubble AI's Google app, through the relay | `gmail.readonly` | Yes |
| Google Calendar | Bubble AI's Google app, through the relay | `calendar.readonly` | Yes |
| Google Drive | Bubble AI's Google app, through the relay | `drive.readonly` | Yes |

Every sign-in makes the connector point at the company's own remote MCP server:
- `mcp.notion.com/mcp`
- `mcp.linear.app/mcp`
- `mcp.vercel.com`
- `api.githubcopilot.com/mcp/`
- `mcp.slack.com/mcp`
- `gmailmcp.googleapis.com/mcp/v1`
- `calendarmcp.googleapis.com/mcp/v1`
- `drivemcp.googleapis.com/mcp/v1`

The hub keeps the tokens and refreshes them before a run. Each run gets the current access token in that connector's `Authorization` header, the same way MCP sign-ins already work. The browser never sees a token, only the companies' sign-in pages and a one-time code.

Gmail and Google Calendar (or any apps from one company) can share one sign-in: `POST /api/connectors/connect` takes up to five catalog ids.

## The two ways it works

**The server's own sign-in (Notion, Linear, Vercel).** This is the MCP spec's OAuth, which `connector-auth.ts` already did for Linear: the hub registers itself with the server and sends the person to its sign-in page.
- These servers only send people back to an https address or to this computer (localhost).
- Vercel only sends people back to localhost.
- From a plain-http address on a home network, Sign in isn't offered and the key is the way in. `GET /api/connectors/sign-in?origin=…` says so in plain words.

**Through Bubble AI's app (GitHub, Slack, Google).** These companies only send people back to an address registered with the app, and every self-hosted hub has its own address. So the registered address is a small relay on Bubble AI's website (`site/functions/`, served at `https://wisp-app.pages.dev`):

1. The hub sends the browser to the company's sign-in page. The page is told to come back to the relay, and `state` carries the hub's own address (`<base64url origin>.<random>`). The hub keeps a PKCE verifier.
2. The company sends the browser to `/oauth/callback` on the relay with a one-time code, and the relay sends it on to the hub's `/api/connectors/app/callback`.
   - If the hub is on this computer (`localhost`, `127.0.0.1`, `::1`), the relay sends it on straight away.
   - Otherwise, home-network addresses included, it first shows "This sign-in goes back to the Bubble AI at `host`. Continue only if that's your Bubble AI." A sign-in link someone else made can't quietly hand the code to their hub. A home-network address isn't trusted, because on a shared network (a café, a hotel) it can be someone else's.
3. The hub calls the relay's `/api/oauth/token` with the code and its verifier. The relay adds the app's secret, asks the company, and passes the answer back. Refreshes go the same way.

**Finishing in the browser that started it.** Every sign-in, through the relay or the server's own, comes back to the hub with only `state` to say which sign-in it is. So the hub also gives the browser that starts a sign-in an HttpOnly cookie holding a random secret (`wisp_signin_…`, 30 minutes, only sent to `/api/connectors/`). A callback that arrives with the matching cookie finishes straight away. One without it gets "Finish signing in: *Name* started this sign-in for *Gmail* in Bubble AI. Continue only if you started it." That stops a sign-in link passed to someone else from quietly connecting their account to the sender's connector. In the desktop app the sign-in opens in the system browser, which doesn't share the app's cookies, so there this page shows every time and one more click finishes it.

Only a sign-in that's really under way gets to put the sign-in page's own error text on Bubble AI's page; anything else says "This sign-in link has expired. Start it again."

If refreshing a token fails because the relay or the company can't be reached, the connector keeps its sign-in and shows "Couldn't renew the sign-in yet". It's only signed out when the company refuses the refresh token. Starting a sign-in again keeps the current one until the new one finishes.

The relay stores nothing. It only trades codes that came back through itself (`redirect_uri` must be its own callback). `GET /api/oauth/apps` lists which apps it has, so hubs offer Sign in only where it works; the rest say "Signing in with Google isn't set up for Bubble AI yet."

A hub can skip the relay with its own apps: set `BUBBLE_GOOGLE_CLIENT_ID` and `BUBBLE_GOOGLE_CLIENT_SECRET` (and `GITHUB_…`, `SLACK_…`) with the redirect `https://<your hub>/api/connectors/app/callback`. Point it at another relay with `BUBBLE_SIGNIN_RELAY=https://…`, or turn the relay off with `BUBBLE_SIGNIN_RELAY=off`.

## What the owner needs to create (not done: needs the owner's accounts)

Nothing here has been created. Notion, Linear and Vercel need none of it.

### 1. Deploy the relay (Cloudflare, the `wisp-app` Pages project)
- `cd site && npm run deploy` deploys `functions/` with the site.
- In the Cloudflare dashboard, open Pages → wisp-app → Settings → Variables and secrets. Add these as encrypted secrets, for Production: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`. Only add the ones that exist; the others stay "isn't set up yet".
- The callback every app below uses is `https://wisp-app.pages.dev/oauth/callback`. If the site moves to its own domain, change it in every app.

### 2. Google (Gmail, Calendar, Drive)
In Google Cloud Console, create a project, for example "Bubble AI".
- **APIs & Services → Library:** enable the Gmail API, the Google Calendar API and the Google Drive API, plus the Gmail, Calendar and Drive MCP services from Google's guide (https://developers.google.com/workspace/guides/configure-mcp-servers).
- **OAuth consent screen:**
  - External. App name Bubble AI, a support email, homepage `https://wisp-app.pages.dev`, privacy policy `https://wisp-app.pages.dev/privacy`.
  - Scopes: `.../auth/gmail.readonly`, `.../auth/calendar.readonly`, `.../auth/drive.readonly`.
  - Leave it in **Testing** and add the Google accounts that will try it as test users (up to 100).
- **Credentials:** Create credentials → OAuth client ID → **Web application**. Authorized redirect URI: `https://wisp-app.pages.dev/oauth/callback`. Copy the client ID and secret into the relay's settings.
- **Going public later:** `gmail.readonly` and `drive.readonly` are restricted scopes. Opening this to everyone needs Google's verification and a yearly CASA assessment; see `docs/connector-events.md`. Until then, only the listed test users can sign in, and Google shows them an "unverified app" screen.

### 3. GitHub
GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App, under the owner or the `eireijie` organization.
- Name: Bubble AI. Homepage `https://wisp-app.pages.dev`.
- Authorization callback URL: `https://wisp-app.pages.dev/oauth/callback`.
- Generate a client secret, then copy the client ID and secret into the relay.
- An OAuth App (not a GitHub App) keeps it to one click. GitHub has no read-only scope for private repos, so read-only is enforced by GitHub's MCP server (`X-MCP-Readonly: true`), not by the token.

### 4. Slack
https://api.slack.com/apps → Create New App → From scratch, "Bubble AI", in the owner's workspace.
- **OAuth & Permissions:**
  - Redirect URL: `https://wisp-app.pages.dev/oauth/callback`.
  - User Token Scopes: `channels:history channels:read groups:history groups:read im:history im:read mpim:history mpim:read search:read.public search:read.private search:read.im search:read.mpim search:read.files users:read files:read canvases:read`.
- **Manage Distribution:** turn on public distribution so other workspaces can sign in.
- Slack's MCP server (`mcp.slack.com`) may require the app to be enabled for MCP or approved by Slack. Check the app's settings for an MCP or AI section. This part is **unproven**.
- Copy the client ID and secret into the relay.

## Proven and unproven (2026-11-22)
- **Proven against the real services:**
  - From a local hub, `connect` registered with and got real sign-in pages from Notion (`mcp.notion.com/authorize`), Linear (`mcp.linear.app/authorize`, scope `read`) and Vercel (`vercel.com/oauth/authorize`).
  - Google's three MCP servers answer at the addresses above and list the read-only scopes used here.
- **Proven with faked companies** (`apps/hub/test/app-signin.test.ts`, run through the relay's real code):
  - Google sign-in for Gmail and Calendar together, the relay forwarding, and the code trade with the secret added.
  - Refresh through the relay, a cancelled sign-in, signing in to GitHub again, and the relay's checks.
- **Unproven: reading a real account.**
  - Notion, Linear and Vercel each need someone to finish the sign-in on the company's page.
  - GitHub, Slack and Google need the apps above first.
  - Whether `mcp.slack.com` accepts a user token from a new Slack app is open.
- **Not built:**
  - **Outlook mail and calendar.** Microsoft's own MCP servers are in Agent 365, a preview that needs a Microsoft 365 Copilot license and a work tenant, and personal Outlook.com accounts aren't covered. A Bubble AI-built Outlook connector over Microsoft Graph would be its own piece of work.
  - The connector-events watchers for Gmail, Calendar and Drive still read `GOOGLE_REFRESH_TOKEN` from a watch, not the new sign-in.
  - The iPhone and Android connector catalogs don't offer sign-in yet.
