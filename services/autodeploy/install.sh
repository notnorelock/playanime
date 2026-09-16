#!/usr/bin/env bash
#
# One-time bootstrap for autodeploy on a VPS: installs Go if it's missing
# or too old, builds the binary, checks the config file is ready, installs
# a systemd service so it runs 24/7 (auto-restarts on crash, starts on
# boot), and starts it.
#
# Usage, from the repo root on the VPS:
#   ./services/autodeploy/install.sh
# or, if the executable bit didn't survive (e.g. checked out on Windows):
#   bash services/autodeploy/install.sh
#
# Before running this:
#   - services/autodeploy/autodeploy.config.json must already exist and be
#     filled in — see README.md in this directory ("Setup" section) for
#     creating the Discord bot and getting every ID this needs. This
#     script checks for the file and for leftover placeholders, but
#     doesn't create it for you (it holds real tokens you have to supply).
#   - A user with sudo (installing the systemd unit needs it). Running
#     this whole script as root also works.
#
# Safe to re-run: skips the Go install if a new-enough version is already
# on PATH, rebuilds the binary either way (picks up any code changes),
# and `systemctl restart` at the end applies a rebuilt binary immediately
# instead of leaving the old one running until the next crash/reboot.

set -euo pipefail

REQUIRED_GO_MAJOR_MINOR="1.24" # matches go.mod's "go 1.24.0" — see that file if this ever needs bumping
GO_INSTALL_VERSION="1.24.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_NAME="autodeploy"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CONFIG_FILE="$SCRIPT_DIR/autodeploy.config.json"
BINARY_PATH="$SCRIPT_DIR/autodeploy"

log() { echo -e "\n\033[1;36m▸ $*\033[0m"; }
warn() { echo -e "\033[1;33mwarning: $*\033[0m" >&2; }

# --- 1. Config file exists and looks filled in -------------------------------
log "1/5 — checking config"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "error: $CONFIG_FILE not found." >&2
  echo "  cp $SCRIPT_DIR/autodeploy.config.example.json $CONFIG_FILE" >&2
  echo "  chmod 600 $CONFIG_FILE" >&2
  echo "  then fill it in — see README.md in this directory for the full setup." >&2
  exit 1
fi

if grep -q "REPLACE_ME" "$CONFIG_FILE"; then
  echo "error: $CONFIG_FILE still has a REPLACE_ME placeholder in it:" >&2
  grep -n "REPLACE_ME" "$CONFIG_FILE" >&2
  exit 1
fi

# --- 2. Go toolchain -----------------------------------------------------------
log "2/5 — Go toolchain (need >= $REQUIRED_GO_MAJOR_MINOR)"
go_version_ok() {
  command -v go &>/dev/null || return 1
  local have
  have="$(go version | grep -oE 'go[0-9]+\.[0-9]+' | tr -d 'go')"
  # Simple major.minor comparison via sort -V, good enough for "1.24" vs "1.21" etc.
  [[ "$(printf '%s\n%s\n' "$REQUIRED_GO_MAJOR_MINOR" "$have" | sort -V | head -1)" == "$REQUIRED_GO_MAJOR_MINOR" ]]
}

if go_version_ok; then
  echo "already installed: $(go version)"
else
  echo "installing Go $GO_INSTALL_VERSION..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) GOARCH=amd64 ;;
    aarch64) GOARCH=arm64 ;;
    *) echo "error: unrecognized architecture '$ARCH' — install Go manually from https://go.dev/dl/ and re-run this script." >&2; exit 1 ;;
  esac

  TARBALL="go${GO_INSTALL_VERSION}.linux-${GOARCH}.tar.gz"
  curl -fsSL "https://go.dev/dl/${TARBALL}" -o "/tmp/${TARBALL}"
  sudo rm -rf /usr/local/go
  sudo tar -C /usr/local -xzf "/tmp/${TARBALL}"
  rm "/tmp/${TARBALL}"

  if ! grep -q '/usr/local/go/bin' /etc/profile.d/go.sh 2>/dev/null; then
    echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee /etc/profile.d/go.sh >/dev/null
  fi
  export PATH="$PATH:/usr/local/go/bin"

  if ! go_version_ok; then
    echo "error: Go install didn't produce a working >= $REQUIRED_GO_MAJOR_MINOR toolchain on PATH." >&2
    exit 1
  fi
  echo "installed: $(go version)"
fi

# --- 3. Build --------------------------------------------------------------------
log "3/5 — building"
(cd "$SCRIPT_DIR" && go build -o "$BINARY_PATH" .)
echo "built $BINARY_PATH"

# --- 4. systemd service ----------------------------------------------------------
log "4/5 — installing the systemd service"

RUN_USER="$(id -un)"
if [[ "$RUN_USER" == root ]]; then
  warn "running as root — the service will run autodeploy (and therefore" \
       "deploy.sh, and therefore every docker compose command it runs) as" \
       "root too. Fine on a single-purpose VPS where root already runs" \
       "Docker; on a shared box, consider a dedicated user instead."
fi

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=PlayAnime autodeploy
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${BINARY_PATH} -config ${CONFIG_FILE}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

# --- 5. Start / restart ------------------------------------------------------------
log "5/5 — starting"
if systemctl is-active --quiet "$SERVICE_NAME"; then
  sudo systemctl restart "$SERVICE_NAME"
  echo "restarted (was already running — picks up the freshly built binary)"
else
  sudo systemctl start "$SERVICE_NAME"
  echo "started"
fi

sleep 2
sudo systemctl status "$SERVICE_NAME" --no-pager -l || true

echo
echo "Done. autodeploy now runs 24/7 under systemd: auto-restarts on crash," \
     "starts automatically on reboot."
echo
echo "Useful commands:"
echo "  sudo systemctl status $SERVICE_NAME     # is it running"
echo "  sudo journalctl -u $SERVICE_NAME -f     # tail logs live"
echo "  sudo systemctl restart $SERVICE_NAME    # restart (e.g. after editing config)"
echo "  sudo systemctl stop $SERVICE_NAME       # stop it"
