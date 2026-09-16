#!/usr/bin/env bash
#
# One-time bootstrap for a brand-new Ubuntu 24.04 VPS: installs Docker,
# opens the firewall, generates production secrets, brings up the full
# stack (postgres + redis + api + webserver + caddy), runs migrations, and
# installs a daily Postgres backup cron job. Run this exactly once per VPS
# — everything after this is `./infrastructure/docker/deploy.sh` on every
# later `git pull`.
#
# Usage, on a fresh VPS:
#   git clone <this repo's URL> playani.me-v2
#   cd playani.me-v2
#   ./infrastructure/docker/install-vps.sh
# or, if the executable bit didn't survive (e.g. checked out on Windows
# then copied over):
#   bash infrastructure/docker/install-vps.sh
#
# Before running this:
#   - DNS: playani.me and www.playani.me's A (and AAAA, if you use IPv6)
#     records must already point at this VPS's IP. Caddy requests its
#     Let's Encrypt cert on first request and retries silently if the
#     domain doesn't resolve here yet — it won't error loudly, it'll just
#     never get a cert.
#   - A non-root user with sudo (installing Docker system-wide, and ufw,
#     both need it). Running this whole script as root also works but isn't
#     necessary and adduser-hardened images may not even have a root
#     password set.
#
# Safe to re-run: every step below either detects it already ran and skips,
# or is naturally idempotent (installing an already-installed package,
# re-adding an already-present ufw rule, `docker compose up -d` on an
# already-running stack). Re-running does NOT regenerate .env.prod if one
# already exists, and does NOT touch the Postgres data volume.

set -euo pipefail

DOMAIN=playani.me
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE=infrastructure/docker/.env.prod
COMPOSE_FILES=(-f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml)

log() { echo -e "\n\033[1;36m▸ $*\033[0m"; }
warn() { echo -e "\033[1;33mwarning: $*\033[0m" >&2; }

# --- 1. Docker + Compose plugin --------------------------------------------
log "1/7 — Docker"
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
log "2/7 — Firewall (ufw: 22, 80, 443, 5432)"
if command -v ufw &>/dev/null; then
  sudo ufw allow 22/tcp   >/dev/null   # don't lock yourself out over SSH
  sudo ufw allow 80/tcp   >/dev/null
  sudo ufw allow 443/tcp  >/dev/null
  # Postgres, intentionally reachable from outside — see
  # infrastructure/docker/README.md for the tradeoff and the SSH-tunnel
  # alternative if you'd rather not expose this.
  sudo ufw allow 5432/tcp >/dev/null
  if sudo ufw status | grep -q "Status: active"; then
    echo "ufw already active — rules ensured."
  else
    echo "y" | sudo ufw enable >/dev/null
    echo "ufw enabled with rules for 22, 80, 443, 5432."
  fi
else
  warn "ufw not found — skipping. If this VPS has a cloud-provider firewall"
  warn "instead (DigitalOcean/Hetzner/AWS security groups, etc.), open 80,"
  warn "443, and 5432 there manually — this script can't reach that from here."
fi

# --- 3. DNS sanity check (non-blocking) --------------------------------------
log "3/7 — DNS check for $DOMAIN"
PUBLIC_IP="$(curl -fsS4 https://api.ipify.org || true)"
DOMAIN_IP="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
if [[ -z "$PUBLIC_IP" ]]; then
  warn "Couldn't determine this VPS's public IP — skipping the DNS check."
elif [[ -z "$DOMAIN_IP" ]]; then
  warn "$DOMAIN doesn't resolve to anything yet. Caddy will retry its cert"
  warn "request silently and playani.me won't be reachable over HTTPS until"
  warn "DNS propagates. Safe to continue — just won't be live immediately."
elif [[ "$DOMAIN_IP" != "$PUBLIC_IP" ]]; then
  warn "$DOMAIN resolves to $DOMAIN_IP, but this VPS's public IP is $PUBLIC_IP."
  warn "If that A record isn't meant to point elsewhere, fix it before"
  warn "Caddy requests a cert, or the request will fail."
else
  echo "$DOMAIN → $DOMAIN_IP matches this VPS. Good."
fi

# --- 4. Secrets ---------------------------------------------------------------
log "4/7 — Production secrets ($ENV_FILE)"
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
log "5/7 — Building and starting the stack"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app build
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app up -d

log "Waiting for the api container to report healthy..."
for _ in $(seq 1 30); do
  status="$(docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app ps --format json api 2>/dev/null | grep -o '"Health":"[a-z]*"' | cut -d'"' -f4 || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done

log "Running database migrations"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app exec -T api \
  bun run --filter '@playanime/database' migrate

# --- 6. Daily backups ----------------------------------------------------------
log "6/7 — Daily Postgres backup cron job"
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

# --- 7. Done --------------------------------------------------------------------
log "7/7 — Status"
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
