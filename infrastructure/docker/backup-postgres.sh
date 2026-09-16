#!/usr/bin/env bash
#
# Dumps the production Postgres database to a timestamped, gzipped file
# under infrastructure/docker/backups/, and deletes anything older than
# $RETENTION_DAYS. Runs via pg_dump inside the postgres container (no local
# Postgres client needed on the VPS itself), over the same compose network
# every other service uses.
#
# Installed as a daily cron job by install-vps.sh; also safe to run by hand
# any time, e.g. right before a risky migration:
#   ./infrastructure/docker/backup-postgres.sh
#
# Restoring from a backup:
#   gunzip -c infrastructure/docker/backups/playanime-<timestamp>.sql.gz | \
#     docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml \
#       --env-file infrastructure/docker/.env.prod --profile app exec -T postgres \
#       psql -U postgres -d playanime
# (Restoring into a database that already has data will conflict on
# existing rows/constraints — this is meant for restoring into a fresh
# volume, e.g. after a genuine disaster, not merging into a live one.)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="$REPO_ROOT/infrastructure/docker/backups"
RETENTION_DAYS=14
ENV_FILE=infrastructure/docker/.env.prod
COMPOSE_FILES=(-f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml)

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found — nothing to back up yet." >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/playanime-${TIMESTAMP}.sql.gz"

docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app exec -T postgres \
  pg_dump -U postgres -d playanime | gzip > "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "$(date -u +%FT%TZ) backed up playanime to $(basename "$OUT_FILE") (${SIZE})"

find "$BACKUP_DIR" -name 'playanime-*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete
