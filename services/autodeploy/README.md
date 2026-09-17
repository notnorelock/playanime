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

`webhook.port` (default `8787`) is the port autodeploy binds. autodeploy
runs as its own container (see "Running it" below), on the same Docker
network as `caddy`/`api`/`webserver` — the `ci.playani.me` site block in
`infrastructure/docker/Caddyfile` reaches it by service name
(`autodeploy:8787`), the same way it already reaches `webserver:3000`.
Nothing is published to the host, so nothing outside this VPS's own
Docker network can reach `webhook.port` directly.

### 4. Config file

```bash
cp autodeploy.config.example.json autodeploy.config.json
chmod 600 autodeploy.config.json   # holds real tokens — owner-only, Load() refuses anything looser
nano autodeploy.config.json
```

Fill in `repoPath` (the VPS's actual checkout, e.g. `/root/playanime`),
`githubToken`, `selfImage` (must match `docker-compose.prod.yml`'s
`autodeploy` service's own `image:` tag — `playanime-autodeploy:latest`
by default, don't change one without the other), and either
`discordWebhookUrl` or the whole `discord` block — plus `webhook` if you
set that up above, and `redisUrl` if you want deploy-in-progress
reattachment (see "Deploy-in-progress coordination" below — optional, but
recommended once you have Discord bot mode running live).

This file lives inside the repo checkout, which `docker-compose.prod.yml`
bind-mounts into the `autodeploy` container at this exact same path — the
container sees the host's real file, with the host's real 0600
permissions, unchanged; `chmod 600` above is still the whole story, no
extra step needed for it to apply inside the container too. The
`autodeploy` container itself runs as root (see
`infrastructure/docker/Dockerfile.autodeploy`'s own comment for why), so
there's no UID-mismatch concern reading a root-owned 0600 file either.

### 5. Running it

autodeploy runs as its own Docker Compose service, alongside
`api`/`webserver`/`caddy`/etc. — no separate install step, no systemd, no
Go toolchain needed on the VPS (the build happens inside the Docker build
stage, see `infrastructure/docker/Dockerfile.autodeploy`). It's built and
started by the exact same command that builds/starts everything else:

```bash
./infrastructure/docker/deploy.sh
```

**First time ever on a fresh VPS**: this is already the documented
one-time manual bootstrap step in `infrastructure/docker/README.md` (clone
the repo, fill in `.env.prod`, run `deploy.sh` once by hand) — nothing
autodeploy-specific needs to happen first. `deploy.sh` runs `docker compose
--profile app build`/`up -d` with no service filter, so `autodeploy` comes
up automatically alongside every other service on that same run.

Once it's running, it deploys itself on every future commit exactly like
it deploys everything else — including, notably, changes to its own code.

```bash
docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml --env-file infrastructure/docker/.env.prod --profile app ps autodeploy       # is it running
docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml --env-file infrastructure/docker/.env.prod --profile app logs -f autodeploy   # tail logs live
docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml --env-file infrastructure/docker/.env.prod --profile app restart autodeploy  # restart (e.g. after editing config by hand)
```

**Self-recreate during a deploy**: because `deploy.sh`'s `docker compose
... up -d` has no service filter, a deploy that changes autodeploy's own
code causes it to recreate the very `autodeploy` container that's
currently running that deploy. Deploy.sh itself doesn't run inside
autodeploy's own container any more, though — see "Deploy-in-progress
coordination" below — so the deploy work in flight survives this
regardless; what actually happens is the replacement `autodeploy`
container comes up, finds the still-running detached deploy container via
Redis, and picks up reporting on it right where the old process left off.

## Deploy-in-progress coordination

`deploy.sh` doesn't run as a direct child process of `autodeploy` — it
runs inside its own **detached sibling container**, launched via `docker
run -d` against the same host Docker socket autodeploy's own container
already has mounted (see `deploy.StartDetached` in `deploy/deploy.go`),
using the exact same image as autodeploy itself (`selfImage` in the
config file, must match `docker-compose.prod.yml`'s `autodeploy` service's
`image:` tag). The container is named `autodeploy-run-<short
commit>-<unix time>` and removes itself (`docker rm`) once the deploy
finishes — `docker ps -a --filter name=autodeploy-run-` is the manual
escape hatch if one is ever left behind despite that.

This exists specifically because of the self-recreate behavior above: a
direct child process of `autodeploy` would be killed the instant Docker
tears down `autodeploy`'s own container to replace it (container removal
tears down the whole PID namespace — no amount of process detachment
survives that) — which meant a deploy that touched autodeploy's own code
could genuinely kill its own in-flight `docker compose build`/`up`,
potentially mid-build. A detached sibling container isn't inside
autodeploy's PID namespace at all, so it keeps running regardless of what
happens to the container that launched it.

**`redisUrl`** (optional, in the config file) is what lets a *replacement*
autodeploy process (the one that comes up after the self-recreate above)
rediscover that detached container and reattach to it, instead of losing
track of it or starting a conflicting second deploy — `deployer.go` writes
a small record (container ID, target commit, current stage, the live
Discord message IDs) to Redis right after starting a detached deploy, and
`main.go` calls `Deployer.Reattach` once at startup, before the poll loop
begins:

- If Redis has a record and the container it names is still running, the
  new process resumes streaming its output, keeps editing the *same* live
  Discord pipeline embed (not a new one), and finalizes state exactly like
  a normal deploy would once it exits.
- If Redis has a record but the container is gone (a host reboot, the
  detached container was itself killed), the record is cleared and the
  run is reported as failed — the next poll finds the target commit still
  unacknowledged and simply starts a fresh deploy.
- Without `redisUrl` configured at all, deploys still run in their own
  detached container (so they're never killed by autodeploy's own
  self-recreate), but a replacement process has no way to know one is
  still running — it starts working from wherever `autodeploy.state.json`
  last says, same as before this feature existed. Purely additive: an
  existing polling-only or webhook-only deployment is unaffected until
  `redisUrl` is set.

## How the approval workflow persists state

`autodeploy.state.json` (next to the config file, gitignored, path
configurable via `stateFile`) tracks the last acknowledged commit
(deployed or Skipped) and any outstanding pending-approval message. Since
it lives inside the repo checkout, which is bind-mounted into the
`autodeploy` container, it survives a container recreate exactly the way
it survived a systemd restart before — a fresh container reloads this
file and picks up exactly where the old one left off, including across
the self-recreate quirk described above.

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
  the webhook is a trigger, not a second source of truth. Its port is
  never published to the host (no `ports:` entry on the `autodeploy`
  Compose service) — the container's own network namespace is what keeps
  it unreachable from outside this VPS's Docker network; only Caddy, a
  sibling container proxying in by service name, can address it at all.
- The `autodeploy` container itself holds host-root-equivalent access via
  the mounted Docker socket (see `docker-compose.prod.yml`'s `autodeploy`
  service and `infrastructure/docker/Dockerfile.autodeploy`'s own comment)
  — a deliberate, discussed tradeoff for being able to run `docker compose
  build/up` against the host's daemon from inside a container. Treat
  anything that can reach this container (or edit its image/command) as
  equivalent to root on the VPS.
- The detached container `deploy.sh` actually runs in (see "Deploy-in-
  -progress coordination" above) gets the exact same Docker socket and
  repo bind mount as autodeploy's own container — it's launched from the
  same image, by a process that already had this access, so this is not a
  new privilege boundary being crossed, just a second container with the
  access autodeploy already had for the duration of one deploy.
- `redisUrl`, when set, only ever holds a small, non-secret coordination
  record (a container ID, a commit hash, Discord message IDs) under one
  fixed key — never a credential. Anything that can write to the same
  Redis instance could in principle plant a bogus record; the actual
  worst case is `Reattach` trying (and failing, harmlessly) to inspect a
  container ID that doesn't belong to a real deploy, not privilege
  escalation — `Deployer.inProgress` and the container-existence check in
  `deploy.IsRunning` are what `Reattach` actually trusts, not the record's
  contents blindly.
