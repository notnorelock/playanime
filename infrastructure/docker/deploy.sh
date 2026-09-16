#!/usr/bin/env bash
#
# Deploys the full PlayAnime stack on a single VPS (Ubuntu 24.04, Docker +
# Compose plugin already installed, .env.prod already filled in — see
# install-vps.sh in this directory for a brand-new VPS that has neither yet;
# it does the one-time setup and calls this script itself at the end).
#
# Wraps:
#   docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml \
#     --env-file infrastructure/docker/.env.prod --profile app up -d --build
#
# Safe to re-run: pulls/builds only what changed, recreates only containers
# whose config or image actually changed, and never touches the postgres
# data volume unless you pass --reset (see below).
#
# Usage (from the repo root, e.g. after `git pull` on the VPS):
#   ./infrastructure/docker/deploy.sh
# or, if this was checked out on Windows and lost its executable bit:
#   bash infrastructure/docker/deploy.sh
#
# Rotating the Postgres password on an *existing* deploy needs one extra
# manual step beyond editing .env.prod — see README.md in this directory.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."  # repo root, regardless of cwd

COMPOSE_FILES=(-f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml)
ENV_FILE=infrastructure/docker/.env.prod

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found." >&2
  echo "  cp infrastructure/docker/.env.prod.example $ENV_FILE" >&2
  echo "  then fill in every CHANGE_ME value before running this script." >&2
  exit 1
fi

if grep -q "CHANGE_ME" "$ENV_FILE"; then
  echo "error: $ENV_FILE still has a CHANGE_ME placeholder in it:" >&2
  grep -n "CHANGE_ME" "$ENV_FILE" >&2
  echo "Fill in every one of these before deploying — the API also refuses" >&2
  echo "to boot with a placeholder SESSION_SECRET or default DB credentials," >&2
  echo "but failing here is faster than waiting for that container to crash." >&2
  exit 1
fi

if [[ "${1:-}" == "--reset" ]]; then
  echo "This will also stop the stack and DELETE the postgres data volume." >&2
  read -r -p "Type the domain (playani.me) to confirm: " confirm
  if [[ "$confirm" != "playani.me" ]]; then
    echo "Confirmation didn't match — aborting, nothing was touched." >&2
    exit 1
  fi
  docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app down -v
fi

echo "Building images..."
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app build

echo "Starting stack..."
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app up -d

echo "Running database migrations..."
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app exec -T api \
  bun run --filter '@playanime/database' migrate

echo
echo "Deployed. Status:"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" --profile app ps

echo
echo "Tail logs with:"
echo "  docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml --env-file infrastructure/docker/.env.prod --profile app logs -f"
