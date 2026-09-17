#!/usr/bin/env bash
#
# One-time bootstrap for a brand-new Ubuntu 24.04 VPS: installs Docker,
# opens the firewall (ufw for SSH/Postgres, iptables restricting 80/443 to
# Cloudflare's IP ranges — see update-cloudflare-firewall.sh), generates
# production secrets, brings up the full stack (postgres + redis + api +
# webserver + caddy), runs migrations, and installs daily cron jobs for
# Postgres backups and the Cloudflare IP-range refresh. Run this exactly
# once per VPS — everything after this is
# `./infrastructure/docker/deploy.sh` on every later `git pull`.
#
# Usage, on a fresh VPS:
#   git clone https://github.com/notnorelock/playanime.git playani.me-v2
#   cd playani.me-v2
#   ./infrastructure/docker/install-vps.sh
# or, if the executable bit didn't survive (e.g. checked out on Windows
# then copied over):
#   bash infrastructure/docker/install-vps.sh
#
# This repo is private — a plain `git clone` on the VPS will prompt for
# credentials. See "Cloning a private repo on the VPS" in README.md in this
# directory for the exact fine-grained-token command and why it's written
# the way it is (not a token embedded directly in the URL, which git would
# otherwise leave sitting in plaintext in .git/config).
#
# Before running this:
#   - DNS: playani.me and www.playani.me must be proxied through Cloudflare
#     (the orange-cloud setting, not "DNS only"), with Cloudflare's own A/AAAA
#     records pointing at this VPS as the origin. Caddy requests its Let's
#     Encrypt cert on first request and retries silently if the domain
#     doesn't resolve yet — it won't error loudly, it'll just never get a
#     cert. Traffic not proxied through Cloudflare (a "DNS only" record, or
#     hitting the VPS's raw IP directly) is dropped by the firewall this
#     script installs — see the "Firewall" section in README.md.
#   - A non-root user with sudo (installing Docker system-wide, and ufw,
#     both need it). Running this whole script as root also works but isn't
#     necessary and adduser-hardened images may not even have a root
#     password set.
#
# Safe to re-run: every step below either detects it already ran and skips,
# or is naturally idempotent (installing an already-installed package,
# re-adding an already-present ufw rule, update-cloudflare-firewall.sh
# replacing its own iptables rules cleanly rather than accumulating
# duplicates, `docker compose up -d` on an already-running stack).
# Re-running does NOT regenerate .env.prod if one already exists, and does
# NOT touch the Postgres data volume.

set -euo pipefail

DOMAIN=playani.me
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE=infrastructure/docker/.env.prod
COMPOSE_FILES=(-f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml)

log() { echo -e "\n\033[1;36m▸ $*\033[0m"; }
warn() { echo -e "\033[1;33mwarning: $*\033[0m" >&2; }

# --- 1. Docker + Compose plugin --------------------------------------------
log "1/8 — Docker"
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  echo "Already installed: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
  if [[ -n "${SUDO_USER:-}" || "$(id -un)" != root ]]; then
    sudo usermod -aG docker "$(id -un)"
    warn "Added $(id -un) to the docker group — this only takes effect in a NEW"
    warn "shell session. If the next step fails with a permission error, log out"
    warn "and back in (or run 'newgrp docker'), then re-run this script."
  fi
fi

# --- 2. Firewall -------------------------------------------------------------
log "2/8 — Firewall (ufw: 22 + 5432 open; iptables: 80/443 Cloudflare-only)"
#
# Two different tools for two different jobs here, deliberately:
#   - ufw for the simple host-level ports (22, 5432) — both are plain
#     listeners this VPS's own processes bind (sshd; Postgres via Docker's
#     usual port-publish path, which ufw's INPUT rules do see correctly).
#   - iptables, directly, for 80/443 — see
#     update-cloudflare-firewall.sh's own header comment for exactly why
#     ufw doesn't reliably restrict a Docker-published port (Docker inserts
#     its own forwarding rules ahead of ufw's INPUT chain) and why the
#     DOCKER-USER chain is used instead.
#
# 80/443 are restricted to Cloudflare's own published IP ranges, not opened
# to the whole internet, because DNS for playani.me only ever points at
# Cloudflare (see the Caddyfile) — nothing legitimate reaches this VPS's raw
# IP on those ports at all, but leaving them open would let anyone who
# discovers the VPS's real IP bypass Cloudflare entirely and, the specific
# bug this was added for, send a forged CF-Connecting-IP header that the
# api container would otherwise trust as the real client IP for rate
# limiting and audit logs.
if command -v ufw &>/dev/null; then
  sudo ufw allow 22/tcp   >/dev/null   # don't lock yourself out over SSH
  # Postgres, intentionally reachable from outside — see
  # infrastructure/docker/README.md for the tradeoff and the SSH-tunnel
  # alternative if you'd rather not expose this.
  sudo ufw allow 5432/tcp >/dev/null
  if sudo ufw status | grep -q "Status: active"; then
    echo "ufw already active — rules for 22/5432 ensured."
  else
    echo "y" | sudo ufw enable >/dev/null
    echo "ufw enabled with rules for 22, 5432."
  fi
else
  warn "ufw not found — skipping 22/5432 rules. If this VPS has a"
  warn "cloud-provider firewall instead (DigitalOcean/Hetzner/AWS security"
  warn "groups, etc.), open 22 and 5432 there manually."
fi

chmod +x infrastructure/docker/update-cloudflare-firewall.sh
if sudo ./infrastructure/docker/update-cloudflare-firewall.sh; then
  echo "80/443 restricted to Cloudflare's IP ranges via iptables."
else
  warn "update-cloudflare-firewall.sh failed — 80/443 may still be open to"
  warn "everyone (Docker's own default rules) or, if this is a re-run,"
  warn "left at whatever the previous successful run set. Investigate"
  warn "before relying on CF-Connecting-IP for anything security-sensitive."
fi

# --- 3. DNS sanity check (non-blocking) --------------------------------------
log "3/8 — DNS check for $DOMAIN"
PUBLIC_IP="$(curl -fsS4 https://api.ipify.org || true)"
DOMAIN_IP="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
# With Cloudflare proxying enabled (the intended, expected setup — see the
# "Before running this" note above), $DOMAIN correctly resolves to one of
# Cloudflare's own IPs, not this VPS's real one, so a straight IP-equality
# check would always "fail" on a correctly configured domain. This treats
# resolving to any published Cloudflare range as success too, and only
# warns when it's neither this VPS's own IP nor a Cloudflare one — which
# means the domain points somewhere unexpected.
domain_ip_is_cloudflare() {
  local ip="$1"
  # `if grep ... ; then return 0; fi` rather than `grep ... && return 0` —
  # under `set -e`, the latter can kill the *calling* script the moment
  # grep doesn't match (the common case here), not just this function;
  # this bit exactly, silently, in update-cloudflare-firewall.sh's own
  # `[[ -z ]] && break` before this fix.
  if { curl -fsS "https://www.cloudflare.com/ips-v4" && curl -fsS "https://www.cloudflare.com/ips-v6"; } 2>/dev/null \
    | grep -qF "$(echo "$ip" | cut -d. -f1-2)" 2>/dev/null; then
    return 0
  fi
  # The coarse /16-prefix grep above is a cheap pre-filter; a real CIDR
  # match isn't worth the complexity here since this check is advisory
  # (non-blocking) — a false "yes, it's Cloudflare" just skips a warning
  # that would otherwise tell the operator to go double check manually.
  return 1
}
if [[ -z "$PUBLIC_IP" ]]; then
  warn "Couldn't determine this VPS's public IP — skipping the DNS check."
elif [[ -z "$DOMAIN_IP" ]]; then
  warn "$DOMAIN doesn't resolve to anything yet. Caddy will retry its cert"
  warn "request silently and playani.me won't be reachable over HTTPS until"
  warn "DNS propagates. Safe to continue — just won't be live immediately."
elif [[ "$DOMAIN_IP" != "$PUBLIC_IP" ]] && ! domain_ip_is_cloudflare "$DOMAIN_IP"; then
  warn "$DOMAIN resolves to $DOMAIN_IP, which is neither this VPS's public"
  warn "IP ($PUBLIC_IP) nor a Cloudflare IP — expected is Cloudflare-proxied"
  warn "DNS (orange cloud) with Cloudflare's own A/AAAA record pointing at"
  warn "this VPS as the origin. If that's not what's configured, fix it"
  warn "before Caddy requests a cert, or the request will fail."
elif [[ "$DOMAIN_IP" == "$PUBLIC_IP" ]]; then
  echo "$DOMAIN → $DOMAIN_IP matches this VPS directly (not proxied through"
  echo "Cloudflare — fine for testing, but the firewall this script installs"
  echo "restricts 80/443 to Cloudflare's ranges, so this VPS won't actually"
  echo "be reachable at $DOMAIN until it's proxied through Cloudflare)."
else
  echo "$DOMAIN → $DOMAIN_IP, a Cloudflare IP — proxied correctly. Good."
fi

# --- 4. Secrets ---------------------------------------------------------------
log "4/8 — Production secrets ($ENV_FILE)"
random_token() { openssl rand -base64 "$1" | tr -d '\n=' | tr '+/' '-_'; }

if [[ -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE already exists — leaving it alone (delete it first to regenerate)."
else
  cp infrastructure/docker/.env.prod.example "$ENV_FILE"
  POSTGRES_PASSWORD="$(random_token 24)"
  SESSION_SECRET="$(random_token 48)"
  # In-place, portable sed (works whether the VPS has GNU or BSD sed).
  sed -i.bak \
    -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${POSTGRES_PASSWORD}#" \
    -e "s#^DATABASE_URL=postgresql://postgres:[^@]*@#DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@#" \
    -e "s#^SESSION_SECRET=.*#SESSION_SECRET=${SESSION_SECRET}#" \
    "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
  echo "Generated a real POSTGRES_PASSWORD and SESSION_SECRET into $ENV_FILE."
  echo "This file holds real credentials and lives only on this VPS's disk —"
  echo "it's gitignored, never commit it. Back it up somewhere safe (a"
  echo "password manager's secure-note feature, e.g.) since losing it means"
  echo "losing the database password too."
fi

if grep -q "CHANGE_ME" "$ENV_FILE"; then
  echo
  echo "error: $ENV_FILE still has a CHANGE_ME placeholder:" >&2
  grep -n "CHANGE_ME" "$ENV_FILE" >&2
  echo "Fill in whatever's left (WEB_URL/API_URL if not $DOMAIN, Discord" >&2
  echo "OAuth if you use it) and re-run this script." >&2
  exit 1
fi

# --- 5. Build + start ---------------------------------------------------------
log "5/8 — Building and starting the stack"
# Real git info for /version.json — see deploy.sh's matching block for why
# this needs exporting before `docker compose build`, not just setting.
export GIT_COMMIT_HASH="$(git rev-parse --short HEAD)"
export GIT_COMMIT_COUNT="$(git rev-list --count HEAD)"
export GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
export GIT_COMMIT_DATE="$(git log -1 --format=%ci | cut -d' ' -f1)"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app build
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app up -d

log "Waiting for the api container to report healthy..."
for _ in $(seq 1 30); do
  status="$(docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app ps --format json api 2>/dev/null | grep -o '"Health":"[a-z]*"' | cut -d'"' -f4 || true)"
  if [[ "$status" == "healthy" ]]; then
    break
  fi
  sleep 2
done

log "Running database migrations"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app exec -T api \
  bun run --filter '@playanime/database' migrate

# --- 6. Daily backups ----------------------------------------------------------
log "6/8 — Daily Postgres backup cron job"
chmod +x infrastructure/docker/backup-postgres.sh
CRON_LINE="0 3 * * * cd ${REPO_ROOT} && ./infrastructure/docker/backup-postgres.sh >> ${REPO_ROOT}/infrastructure/docker/backups/backup.log 2>&1"
if crontab -l 2>/dev/null | grep -qF "backup-postgres.sh"; then
  echo "Backup cron job already installed."
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo "Installed: daily pg_dump at 03:00, kept 14 days, under infrastructure/docker/backups/"
fi
echo "Running one backup now, to confirm it works:"
./infrastructure/docker/backup-postgres.sh

# --- 7. Daily Cloudflare IP-range refresh (root's crontab — iptables needs root) -
log "7/8 — Daily Cloudflare firewall refresh cron job"
CF_CRON_LINE="0 4 * * * cd ${REPO_ROOT} && ./infrastructure/docker/update-cloudflare-firewall.sh >> ${REPO_ROOT}/infrastructure/docker/backups/cf-firewall.log 2>&1"
if sudo crontab -l 2>/dev/null | grep -qF "update-cloudflare-firewall.sh"; then
  echo "Cloudflare firewall refresh cron job already installed."
else
  (sudo crontab -l 2>/dev/null; echo "$CF_CRON_LINE") | sudo crontab -
  echo "Installed: daily Cloudflare IP-range refresh at 04:00 (root's crontab)."
fi

# --- 8. Done --------------------------------------------------------------------
log "8/8 — Status"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app ps

echo
echo "Done. https://$DOMAIN should be live (allow a minute for Caddy's first"
echo "cert request if DNS only just finished propagating)."
echo
echo "From now on, deploy code changes with:"
echo "  git pull && ./infrastructure/docker/deploy.sh"
echo
echo "Postgres data persists in the named volume 'playanime_pg' across"
echo "restarts and redeploys — only 'docker compose down -v' or"
echo "'./deploy.sh --reset' would delete it. Daily backups now also run at"
echo "03:00 into infrastructure/docker/backups/ (kept 14 days) as a second"
echo "line of defense against disk failure or an accidental -v."
