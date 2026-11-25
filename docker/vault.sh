#!/bin/sh
# The Wisp vault on a Wisp server: Vaultwarden (your passwords, used with the official Bitwarden apps)
# and the vault bridge (lets agents fill logins from it), next to the hub. Run as root in /opt/wisp.
#
#   sh vault.sh on       turn it on, then print the link to make your vault account
#   sh vault.sh link     a new one-hour link for making an account (yours, or the agents' once invited)
#   sh vault.sh close    close sign-ups (done for you within the hour once your account exists)
#   sh vault.sh off      stop it; your vault stays in /opt/wisp/vault
#   sh vault.sh backup   copy the vault to /opt/wisp/backups/vault (nightly, kept 14 days)
#
# It works the same on new and older servers: everything goes in compose.override.yaml (which
# docker compose reads with compose.yaml) and vault.caddy (imported into the Caddyfile), so the
# files cloud-init wrote stay as they are. The hub image carries this script at docker/vault.sh.
#
# Wisp never makes vault accounts or sees master passwords: you make your account on the vault's
# own page. Until then, only someone with the link this prints can make one.
set -eu
umask 077
cd /opt/wisp

rand() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# The vault gets its own web address, not a path under Wisp's: a page on Wisp's address (an agent's
# message shown there, say) could otherwise read the vault's pages and what's typed into them.
sslip=$(sed -n 's|^https://\([0-9-]*\.sslip\.io\)$|\1|p' url 2>/dev/null | head -n 1)
[ -n "$sslip" ] || { echo "Wisp vault: /opt/wisp/url has no sslip.io address; run /opt/wisp/start.sh first" >&2; exit 1; }
host="vault.$sslip"
url="https://$host"
repo=$(sed -n 's/^WISP_REPO=//p' .env 2>/dev/null || true)
repo=${repo:-eireijie/wisp}

link() {
  key=$(rand)
  printf '%s' "$key" > vault-setup-key
  write_caddy
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
  echo "Open this within the hour to make a vault account (it works once per browser):"
  echo "  $url/vault-setup?key=$key"
}

write_caddy() {
  key=$(cat vault-setup-key 2>/dev/null || rand)
  cat > vault.caddy <<EOF
# Wisp vault (written by vault.sh), imported at the end of the Caddyfile: its own site, so nothing on
# Wisp's own address shares an origin with it.
https://$host {
  handle /vault-setup {
    @wispVaultKey query key=$key
    header @wispVaultKey Set-Cookie "wisp_vault_setup=$key; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Strict"
    redir @wispVaultKey /#/register 302
    respond "This link has expired. Run: sudo sh /opt/wisp/vault.sh link" 403
  }
  # the bridge's page where the owner signs the agents' account in (it needs a one-time code from Wisp)
  handle /vault-bridge/connect {
    reverse_proxy vault-bridge:8088
  }
  handle {
    # its admin page stays off (no ADMIN_TOKEN), and isn't even reachable
    @wispVaultAdmin path /admin /admin/*
    respond @wispVaultAdmin 404
    # making an account needs the setup link's cookie, on top of Vaultwarden's own sign-up rules
    @wispVaultRegister {
      path /identity/accounts/register* /api/accounts/register*
      not header Cookie *wisp_vault_setup=$key*
    }
    respond @wispVaultRegister "Ask the owner of this Wisp for a sign-up link." 403
    reverse_proxy vault:80
  }
}
EOF
  chmod 600 vault.caddy
}

on() {
  command -v sqlite3 >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq sqlite3 >/dev/null; }
  mkdir -p vault vault-bridge backups/vault
  chmod 700 vault backups backups/vault
  chown 1000:1000 vault-bridge
  chmod 700 vault-bridge
  [ -s vault-secrets ] || printf 'BRIDGE_HUB_TOKEN=%s\nBRIDGE_REDEEM_TOKEN=%s\n' "$(rand)" "$(rand)" > vault-secrets
  chmod 600 vault-secrets
  hub_token=$(sed -n 's/^BRIDGE_HUB_TOKEN=//p' vault-secrets)
  redeem_token=$(sed -n 's/^BRIDGE_REDEEM_TOKEN=//p' vault-secrets)
  signups=true
  [ -e vault-signups-closed ] && signups=false
  umask 077
  cat > vault.env <<EOF
DOMAIN=$url
SIGNUPS_ALLOWED=$signups
INVITATIONS_ALLOWED=true
SIGNUPS_VERIFY=false
PASSWORD_HINTS_ALLOWED=false
SHOW_PASSWORD_HINT=false
WEBSOCKET_ENABLED=true
EOF
  cat > compose.override.yaml <<EOF
# Wisp vault (written by vault.sh; "sh vault.sh off" turns it off). Holds the bridge's tokens: keep it private.
services:
  wisp:
    environment:
      WISP_VAULT_BRIDGE_URL: http://vault-bridge:8088
      WISP_VAULT_BRIDGE_TOKEN: "$hub_token"
      WISP_VAULT_URL: "$url"
      WISP_VAULT_CONNECT_URL: "$url/vault-bridge/connect"
  device:
    environment:
      WISP_VAULT_BRIDGE_URL: http://127.0.0.1:8088
      WISP_VAULT_REDEEM_TOKEN: "$redeem_token"
  vault:
    image: vaultwarden/server:latest
    restart: unless-stopped
    env_file: ./vault.env
    volumes:
      - ./vault:/data
  vault-bridge:
    image: ghcr.io/$repo-vault-bridge:latest
    restart: unless-stopped
    environment:
      BRIDGE_HUB_TOKEN: "$hub_token"
      BRIDGE_REDEEM_TOKEN: "$redeem_token"
      # the Bitwarden CLI only talks HTTPS, so it goes the way the Bitwarden apps do: through Caddy
      BW_SERVER: "$url"
    ports:
      # for the device, which runs on the host's network
      - "127.0.0.1:8088:8088"
    volumes:
      - ./vault-bridge:/data
  caddy:
    volumes:
      - ./vault.caddy:/etc/caddy/vault.caddy:ro
EOF
  [ -s vault-setup-key ] || { rand > vault-setup-key; chmod 600 vault-setup-key; }
  write_caddy
  grep -q 'import /etc/caddy/vault.caddy' Caddyfile || printf '\nimport /etc/caddy/vault.caddy\n' >> Caddyfile

  printf '#!/bin/sh\nsh /opt/wisp/vault.sh autoclose\n' > /etc/cron.hourly/wisp-vault
  printf '#!/bin/sh\nsh /opt/wisp/vault.sh backup\n' > /etc/cron.daily/wisp-vault-backup
  chmod 755 /etc/cron.hourly/wisp-vault /etc/cron.daily/wisp-vault-backup

  docker compose pull -q vault vault-bridge
  docker compose up -d
  docker compose restart caddy >/dev/null
  echo "The Wisp vault is on at $url"
  [ "$signups" = true ] && link
  echo "Then in Wisp: Settings → Memory vault."
}

close() {
  touch vault-signups-closed
  # the old sign-up link stops working too
  rand > vault-setup-key
  write_caddy
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null || true
  sed -i 's/^SIGNUPS_ALLOWED=.*/SIGNUPS_ALLOWED=false/' vault.env
  docker compose up -d --force-recreate vault >/dev/null
  echo "Sign-ups are closed. New accounts need an invitation from inside the vault."
}

autoclose() {
  [ -e vault-signups-closed ] && return 0
  [ -f vault/db.sqlite3 ] || return 0
  users=$(sqlite3 -readonly vault/db.sqlite3 'SELECT COUNT(*) FROM users' 2>/dev/null || echo 0)
  [ "${users:-0}" -ge 1 ] && close
  return 0
}

backup() {
  [ -f vault/db.sqlite3 ] || return 0
  day=$(date +%F)
  tmp=$(mktemp -d)
  sqlite3 vault/db.sqlite3 ".backup '$tmp/db.sqlite3'"
  for f in vault/rsa_key* vault/config.json vault/attachments vault/sends; do [ -e "$f" ] && cp -a "$f" "$tmp/"; done
  umask 077
  tar -czf "backups/vault/vault-$day.tar.gz" -C "$tmp" .
  rm -rf "$tmp"
  find backups/vault -name 'vault-*.tar.gz' -mtime +14 -delete
}

off() {
  # the Caddyfile still imports vault.caddy, so it stays (with no site in it) and stays mounted
  printf '# Wisp vault is off (sh vault.sh on to turn it on)\n' > vault.caddy
  printf 'services:\n  caddy:\n    volumes:\n      - ./vault.caddy:/etc/caddy/vault.caddy:ro\n' > compose.override.yaml
  rm -f /etc/cron.hourly/wisp-vault /etc/cron.daily/wisp-vault-backup
  docker compose up -d --remove-orphans
  docker compose restart caddy >/dev/null
  echo "The Wisp vault is off. Your vault is still in /opt/wisp/vault."
}

case "${1:-}" in
  on) on ;;
  link) link ;;
  close) close ;;
  autoclose) autoclose ;;
  backup) backup ;;
  off) off ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
