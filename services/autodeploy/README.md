# autodeploy

A small Go daemon that polls this repo's git remote every few minutes and,
when it finds new commits, either deploys them automatically or (with a
Discord bot configured) posts an approval request and waits for a dev-role
member to click Approve or Skip. Exists specifically to close off "ran
`deploy.sh` without pulling first" — see the memory this project keeps
about that incident — by making pull-then-deploy one automatic step
instead of two manual ones a person can do out of order.

## Two modes

**Webhook-only** (`discord.botToken` unset): every new commit deploys
immediately, a plain webhook message reports success/failure. This is the
original, simpler behavior — no bot invite, no approval gate.

**Discord bot** (`discord.botToken` set): new commits post an approval
request — a changelog of what's new, `@`-pinging the dev role — to a
private channel with Approve/Skip buttons. Nothing deploys until someone
clicks Approve, or runs `/deploy` (which bypasses the gate — running the
command already is the approval). Both channels also get a live,
step-by-step pipeline message (pulling/building/deploying, edited in place
as it progresses, custom emoji per stage if `discord.stageEmojis` is
configured) once a deploy actually starts, showing every new commit's
message and a per-file `+`/`-`/`~` change summary; the private channel also
gets full output on failure. `/status` shows the last deployed commit and
whether anything is currently pending.

Either mode also works with the optional GitHub webhook below — it's an
independent, additive fast-trigger, not a third mode.

## Setup

### 1. GitHub token

Same as the VPS clone itself needs (see
`infrastructure/docker/README.md`'s "Cloning a private repo on the VPS")
— a fine-grained PAT, read-only, scoped to just this repo. Can be the same
token the VPS already uses to `git pull`, or a separate one; either works
identically here.

### 2. Discord bot (optional — skip for webhook-only mode)

1. https://discord.com/developers/applications → New Application
2. **Bot** tab → Reset Token, copy it → `discord.botToken`
3. Still on **Bot** → enable **Server Members Intent** if you want role
   checks to work reliably (discordgo caches member data as it sees it;
   this intent lets it fetch role info without waiting for the member to
   already be cached from some other event)
4. **OAuth2 → URL Generator** → scopes: `bot`, `applications.commands` →
   bot permissions: **Send Messages**, **Embed Links**,
   **Mention @everyone, @here, and All Roles** (the last one is what lets
   the pending-approval message actually ping the role, not just link it)
5. Open the generated URL, invite the bot to your server
6. Enable Developer Mode (Discord Settings → Advanced) so you can
   right-click to copy IDs:
   - Right-click your server icon → Copy Server ID → `discord.guildId`
   - Right-click each dev role in Server Settings → Roles → Copy Role ID →
     `discord.allowedRoleIds` (comma-separated if more than one — a member
     needs only one of them, not all, e.g. `"111...,222..."`)
   - Right-click the public updates channel → Copy Channel ID →
     `discord.publicChannelId`
   - Right-click the private/dev channel → Copy Channel ID →
     `discord.privateChannelId`

### 3. GitHub webhook (optional — faster than polling)

Without this, autodeploy only notices a new commit on its next scheduled
poll (`pollIntervalSeconds`, default 150s / 2.5 min). A webhook cuts that
to seconds — GitHub tells autodeploy the instant something's pushed,
autodeploy checks right then instead of waiting. Polling keeps running
either way as a fallback (a dropped delivery, a wrong secret, GitHub itself
being down) — this is additive, not a replacement.

1. Add a DNS record for `ci.playani.me` in Cloudflare — same as
   `playani.me`/`www`, proxied (orange cloud), pointed at this VPS.
2. Generate a real secret (anything long and random —
   `openssl rand -hex 32` works well) → `webhook.secret` in the config
   file below.
3. Set `webhook.enabled` to `true` in the config file.
4. On GitHub: repo → **Settings → Webhooks → Add webhook**
   - Payload URL: `https://ci.playani.me/github`
   - Content type: `application/json`
   - Secret: the same value as `webhook.secret`
   - "Which events?": **Just the push event**
5. After saving, GitHub sends a `ping` delivery immediately — check its
   response in the webhook's **Recent Deliveries** tab (should be `200`)
   to confirm the URL, DNS, and secret all actually line up before relying
   on it.

`webhook.port` (default `8787`) is the loopback-only port autodeploy binds
— Caddy reaches it from inside its own container via the `ci.playani.me`
site block in `infrastructure/docker/Caddyfile`, which needs the `caddy`
service's `extra_hosts: [autodeploy-host=host-gateway]` entry in
`infrastructure/docker/docker-compose.prod.yml` (already there once you've
pulled this) to reach a process running on the host itself rather than
another container. Nothing outside this VPS can reach `webhook.port`
directly — see `webhook/webhook.go`'s own doc comment for why binding
loopback matters even with the firewall already restricting inbound
80/443 to Cloudflare's ranges.

### 4. Config file

```bash
cp autodeploy.config.example.json autodeploy.config.json
chmod 600 autodeploy.config.json   # holds real tokens — owner-only, Load() refuses anything looser
nano autodeploy.config.json
```

Fill in `repoPath` (the VPS's actual checkout, e.g. `/root/playanime`),
`githubToken`, and either `discordWebhookUrl` or the whole `discord` block
— plus `webhook` if you set that up above.

### 5. Install (build + run 24/7 under systemd)

```bash
./install.sh
```

Installs Go if it's missing or older than this module needs, builds the
binary, installs it as a systemd service (auto-restarts on crash, starts
on boot — systemd is already part of Ubuntu 24.04, no extra runtime to
install), and starts it. Refuses to proceed if `autodeploy.config.json`
is missing or still has a `REPLACE_ME` placeholder in it. Safe to re-run
any time (e.g. after `git pull` brings in autodeploy code changes) — it
rebuilds and restarts the service with the new binary.

```bash
sudo systemctl status autodeploy      # is it running
sudo journalctl -u autodeploy -f      # tail logs live
sudo systemctl restart autodeploy     # restart (e.g. after editing config by hand)
```

<details>
<summary>What install.sh does, if you'd rather do it by hand</summary>

```bash
go build -o autodeploy .
```

then a systemd unit:

```ini
# /etc/systemd/system/autodeploy.service
[Unit]
Description=PlayAnime autodeploy
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/playanime/services/autodeploy
ExecStart=/root/playanime/services/autodeploy/autodeploy -config /root/playanime/services/autodeploy/autodeploy.config.json
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now autodeploy
```

</details>

## How the approval workflow persists state

`autodeploy.state.json` (next to the binary, gitignored, path configurable
via `stateFile`) tracks the last acknowledged commit (deployed or
Skipped) and any outstanding pending-approval message. A restart doesn't
lose track of a pending approval or forget what's already been deployed —
it reloads this file and picks up exactly where it left off.

## What "auto-detect which service to rebuild" turned out to mean

Every Dockerfile in `infrastructure/docker/` copies the *entire*
`packages/` tree unconditionally (`COPY packages/ packages/`), so Docker's
own build cache already invalidates all three buildable services (api,
web, webserver) on nearly any source change — there's no safe, meaningful
per-package skip to reimplement without risking a stale rebuild. autodeploy
runs `deploy.sh` (which runs a plain `docker compose build`, no service
list) and trusts Docker's own layer cache to do that work correctly,
rather than second-guessing it with a hand-rolled path-to-service mapping
that could drift out of sync with the Dockerfiles and silently skip a
rebuild that was actually needed.

## Security notes

- `autodeploy.config.json` holds a GitHub token and (in bot mode) a
  Discord bot token — both real credentials. Gitignored, and `Load()`
  refuses to start if the file is readable by anyone but its owner.
- The GitHub token is injected per git invocation via `-c
  http.extraHeader`, never written into `.git/config` or a remote URL —
  see `git/git.go`.
- `/deploy` and the Approve/Skip buttons check the invoking member's roles
  against `discord.allowedRoleIds` (any one match is enough) — `/status`
  is unrestricted (read-only).
- A deploy already in progress refuses a second concurrent one (from a
  poll and a `/deploy` racing, or two rapid `/deploy` calls) rather than
  running `deploy.sh` twice at once.
- The webhook listener (`webhook/webhook.go`) verifies every delivery's
  `X-Hub-Signature-256` header (HMAC-SHA256 against `webhook.secret`,
  constant-time compared) before doing anything with it, and only ever
  uses the payload to read which branch was pushed to — never the commit
  list or any other field. What actually changed is always established by
  `Deployer.Poll` talking to git directly, the same as a scheduled poll —
  the webhook is a trigger, not a second source of truth. It also binds
  `127.0.0.1` only, never a public interface, as a second layer of
  protection independent of the firewall/Caddy routing.
