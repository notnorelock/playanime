#!/usr/bin/env bash
#
# Restricts inbound 80/443 to Cloudflare's currently-published IP ranges,
# via iptables (not ufw — see below for why), and refreshes that list.
# Installed as a daily cron job by install-vps.sh; also safe to run by hand
# any time Cloudflare announces a range change:
#   sudo ./infrastructure/docker/update-cloudflare-firewall.sh
#
# Why this exists: playani.me's DNS only ever points at Cloudflare, so
# nothing legitimate reaches this VPS's raw IP on 80/443 at all — but
# leaving those ports open to the whole internet lets anyone who discovers
# the VPS's real IP bypass Cloudflare entirely (skip its WAF/DDoS
# mitigation, and — the specific bug this was written for — send a forged
# CF-Connecting-IP header that the api container would otherwise trust as
# the real client IP for rate limiting and audit logs; see resolveClientIp
# in packages/api/src/plugins/security.ts). Restricting inbound 80/443 to
# Cloudflare's ranges is what makes trusting that header safe.
#
# Why iptables and not ufw: this stack runs entirely through Docker Compose
# with published ports (`ports: - '80:80'` etc. by way of Caddy, and
# `'5432:5432'` for postgres). Docker manages iptables directly — on every
# container (re)start it inserts its own DNAT/forwarding rules into the
# FORWARD chain, ahead of anything ufw adds to INPUT. A ufw rule that looks
# like it blocks a port often does nothing for a Docker-published one,
# because the packet never reaches ufw's INPUT chain the way it would for a
# non-Docker process — it's routed by Docker's own rules first. Docker
# creates a dedicated DOCKER-USER chain specifically so operators have a
# place to insert rules that Docker's own chain management won't silently
# bypass or reorder past: every packet destined for a published container
# port is guaranteed to traverse DOCKER-USER before Docker's own DNAT/ACCEPT
# rules act on it. This script's rules go there, not into INPUT/FORWARD
# directly.
#
# Idempotent: every existing rule this script owns (tagged with the
# CF-FIREWALL comment below) is removed and re-added fresh on every run, so
# re-running after Cloudflare rotates its ranges picks up both additions
# and removals correctly — unlike a plain "append new rules" approach, nothing
# stale is left behind.

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "error: must run as root (iptables needs it) — try: sudo $0" >&2
  exit 1
fi

if ! command -v iptables &>/dev/null; then
  echo "error: iptables not found." >&2
  exit 1
fi

RULE_COMMENT="cf-firewall-managed"
CLOUDFLARE_IPS_URL_V4="https://www.cloudflare.com/ips-v4"
CLOUDFLARE_IPS_URL_V6="https://www.cloudflare.com/ips-v6"

CF_RANGES_V4="$(curl -fsS "$CLOUDFLARE_IPS_URL_V4" 2>/dev/null || true)"
CF_RANGES_V6="$(curl -fsS "$CLOUDFLARE_IPS_URL_V6" 2>/dev/null || true)"

if [[ -z "$CF_RANGES_V4" ]]; then
  echo "error: couldn't fetch $CLOUDFLARE_IPS_URL_V4 — leaving existing rules untouched." >&2
  echo "(Not falling back to 'allow everyone': that would silently widen access" >&2
  echo "on a transient network failure. Re-run once cloudflare.com is reachable.)" >&2
  exit 1
fi

# --- Ensure DOCKER-USER exists and is wired into FORWARD -----------------
# Docker creates this chain itself once any container publishes a port, but
# a VPS that hasn't started the stack yet (first run of install-vps.sh,
# before "docker compose up") won't have it yet.
iptables -N DOCKER-USER 2>/dev/null || true

# --- Remove every rule this script previously added -----------------------
# iptables has no "replace by tag" primitive, so this loops: find a rule
# number matching our comment, delete it, repeat until none remain. Safer
# than tracking exact rule text (which changes as ranges rotate).
remove_tagged_rules() {
  local chain="$1"
  local line
  while true; do
    # `grep` finding nothing exits 1, and so does the `[[ -z ]] && break`
    # idiom under `set -e` (bash's exit status for a short-circuited `&&`
    # with `break` on the right isn't reliably 0) — either one previously
    # killed this whole script silently, with no error printed, the moment
    # there was nothing left to remove (including the very first run, with
    # nothing to remove yet at all). `|| true` on the assignment absorbs
    # grep's exit code, and the `if` below replaces the `&&`-chain so the
    # loop's own exit is always deliberate, not an artifact of `set -e`.
    line="$(iptables -L "$chain" -n --line-numbers 2>/dev/null | grep "$RULE_COMMENT" | head -1 | awk '{print $1}' || true)"
    if [[ -z "$line" ]]; then
      break
    fi
    iptables -D "$chain" "$line"
  done
}
remove_tagged_rules DOCKER-USER

# --- Re-add: allow Cloudflare on 80/443, drop everyone else on those ports
# Order matters — the allow rules for Cloudflare's ranges must come before
# the final DROP. Both are inserted at the top of DOCKER-USER (ahead of
# Docker's own ACCEPT rules for the published ports) via -I, in reverse
# order, so the net effect reads top-to-bottom as: allow CF v4, allow CF v6,
# drop everyone else on 80/443, then fall through to Docker's normal rules
# for every other port (5432, and anything else) unaffected.
iptables -I DOCKER-USER 1 -p tcp -m multiport --dports 80,443 -j DROP -m comment --comment "$RULE_COMMENT"

add_v4=0
while IFS= read -r range; do
  if [[ -z "$range" ]]; then
    continue
  fi
  iptables -I DOCKER-USER 1 -p tcp -s "$range" -m multiport --dports 80,443 -j ACCEPT -m comment --comment "$RULE_COMMENT"
  add_v4=$((add_v4 + 1))
done <<< "$CF_RANGES_V4"

add_v6=0
if [[ -n "$CF_RANGES_V6" ]] && command -v ip6tables &>/dev/null; then
  ip6tables -N DOCKER-USER 2>/dev/null || true
  # ip6tables has its own independent rule set — remove_tagged_rules only
  # touched the v4 table above, so the v6 chain needs the same treatment.
  # Same `if` (not `&&`-chained `break`) fix as remove_tagged_rules above,
  # for the same set -e reason.
  while true; do
    line="$(ip6tables -L DOCKER-USER -n --line-numbers 2>/dev/null | grep "$RULE_COMMENT" | head -1 | awk '{print $1}' || true)"
    if [[ -z "$line" ]]; then
      break
    fi
    ip6tables -D DOCKER-USER "$line"
  done
  ip6tables -I DOCKER-USER 1 -p tcp -m multiport --dports 80,443 -j DROP -m comment --comment "$RULE_COMMENT"
  while IFS= read -r range; do
    if [[ -z "$range" ]]; then
      continue
    fi
    ip6tables -I DOCKER-USER 1 -p tcp -s "$range" -m multiport --dports 80,443 -j ACCEPT -m comment --comment "$RULE_COMMENT"
    add_v6=$((add_v6 + 1))
  done <<< "$CF_RANGES_V6"
else
  echo "warning: no IPv6 Cloudflare ranges applied (ip6tables unavailable, or fetch failed) — if this VPS has an AAAA record for playani.me, IPv6 traffic on 80/443 is NOT currently restricted." >&2
fi

echo "$(date -u +%FT%TZ) DOCKER-USER updated: ${add_v4} Cloudflare IPv4 ranges, ${add_v6} IPv6 ranges allowed on 80/443, everything else on those ports dropped."
