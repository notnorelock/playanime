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
command already is the approval). Both channels get a build-report embed
once a deploy actually happens; the public channel gets a short version,
the private one also gets full output on failure. `/status` shows the
last deployed commit and whether anything is currently pending.

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

### 3. Config file

```bash
cp autodeploy.config.example.json autodeploy.config.json
chmod 600 autodeploy.config.json   # holds real tokens — owner-only, Load() refuses anything looser
nano autodeploy.config.json
```

Fill in `repoPath` (the VPS's actual checkout, e.g. `/root/playanime`),
`githubToken`, and either `discordWebhookUrl` or the whole `discord` block.

### 4. Build and run

```bash
go build -o autodeploy .
./autodeploy -config autodeploy.config.json
```

### 5. Run it as a systemd service (so it survives reboots/SSH disconnects)

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
sudo journalctl -u autodeploy -f   # tail its logs
```

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
