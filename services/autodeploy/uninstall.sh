#!/usr/bin/env bash
#
# Removes autodeploy's systemd service — the reverse of install.sh.
# Stops the service if running, disables it (won't start on next boot),
# removes the unit file, and reloads systemd so it forgets the unit ever
# existed.
#
# Usage, from the repo root on the VPS:
#   ./services/autodeploy/uninstall.sh
# or, if the executable bit didn't survive (e.g. checked out on Windows):
#   bash services/autodeploy/uninstall.sh
#
# What this does NOT remove, on purpose — none of these are systemd's
# concern, and all of them hold either real secrets or deploy history you
# almost certainly want to keep even after uninstalling the service itself:
#   - autodeploy.config.json (a real GitHub token, and in bot mode a real
#     Discord bot token)
#   - autodeploy.state.json (or wherever `stateFile` points) — the
#     approval-workflow's persisted last-acknowledged-commit history
#   - the built `autodeploy` binary next to this script
#   - the repo checkout itself (RepoPath in the config)
# Pass --purge to also delete the config, state file, and binary — see the
# confirmation prompt it requires below. There is no flag to delete the
# repo checkout; that's never done by this script under any option.
#
# Safe to re-run: `systemctl stop`/`disable` on an already-stopped/disabled
# service, and removing an already-absent unit file, are all no-ops here,
# not errors.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="autodeploy"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CONFIG_FILE="$SCRIPT_DIR/autodeploy.config.json"
BINARY_PATH="$SCRIPT_DIR/autodeploy"

log() { echo -e "\n\033[1;36m▸ $*\033[0m"; }
warn() { echo -e "\033[1;33mwarning: $*\033[0m" >&2; }

PURGE=false
if [[ "${1:-}" == "--purge" ]]; then
  PURGE=true
fi

# --- 1. Stop the service, if running ------------------------------------------
log "1/4 — stopping the service"
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  sudo systemctl stop "$SERVICE_NAME"
  echo "stopped"
else
  echo "not running — nothing to stop"
fi

# --- 2. Disable it (won't start on next boot) ---------------------------------
log "2/4 — disabling the service"
if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
  sudo systemctl disable "$SERVICE_NAME"
  echo "disabled"
else
  echo "already not enabled — nothing to disable"
fi

# --- 3. Remove the unit file and reload systemd -------------------------------
log "3/4 — removing the systemd unit"
if [[ -f "$SERVICE_FILE" ]]; then
  sudo rm -f "$SERVICE_FILE"
  sudo systemctl daemon-reload
  # Clears systemd's "unit file changed on disk" / failed-state bookkeeping
  # for a unit that no longer has a file backing it — daemon-reload alone
  # does not always do this.
  sudo systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
  echo "removed $SERVICE_FILE"
else
  echo "$SERVICE_FILE not present — nothing to remove"
fi

# --- 4. Optional purge of config/state/binary ---------------------------------
log "4/4 — config, state, and binary"
if [[ "$PURGE" != true ]]; then
  echo "Left in place (holds real tokens / deploy history — pass --purge to also remove):"
  [[ -f "$CONFIG_FILE" ]] && echo "  $CONFIG_FILE"
  [[ -f "$BINARY_PATH" ]] && echo "  $BINARY_PATH"
  find "$SCRIPT_DIR" -maxdepth 1 -name '*.state.json' -print 2>/dev/null | sed 's/^/  /'
else
  echo "This will DELETE the config file (real GitHub/Discord tokens) and any"
  echo "*.state.json deploy-history files in $SCRIPT_DIR. The binary is also"
  echo "removed (harmless — install.sh rebuilds it from source)."
  read -r -p "Type 'purge' to confirm: " confirm
  if [[ "$confirm" != "purge" ]]; then
    echo "Confirmation didn't match — config/state/binary left untouched." >&2
  else
    rm -f "$CONFIG_FILE" "$BINARY_PATH"
    find "$SCRIPT_DIR" -maxdepth 1 -name '*.state.json' -delete
    echo "removed config, state file(s), and binary"
  fi
fi

echo
echo "Done. autodeploy's systemd service is uninstalled — the repo checkout" \
     "and deploy.sh are untouched; the site keeps running exactly as it was" \
     "last deployed, it just won't auto-deploy anymore until you run" \
     "install.sh again."
