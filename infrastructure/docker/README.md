# Production deploy (single VPS)

Ubuntu 24.04, Docker + Compose, Caddy for automatic HTTPS.

**First time on a brand-new VPS:**
```bash
git clone <this repo's URL> playani.me-v2
cd playani.me-v2
./infrastructure/docker/install-vps.sh
```
Installs Docker, opens the firewall (80/443/5432), generates
`infrastructure/docker/.env.prod` with real secrets, builds and starts the
whole stack, runs migrations, and installs a daily Postgres backup cron
job — all in one run, safe to re-run if it fails partway (see its own
header comment for the full detail and prerequisites, mainly that DNS for
playani.me/www.playani.me must already point at the VPS).

**Every deploy after that** (a `git pull` with new code):
```bash
./infrastructure/docker/deploy.sh
```

The rest of this file covers what those two scripts point back to:
secrets, connecting Drizzle Studio, and backups.

## Secrets never go in the repo

`infrastructure/docker/.env.prod` holds every real credential this stack
needs (`POSTGRES_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`, ...). It's
gitignored — `.env.prod.example` is the only version-controlled copy, and
it only has placeholders. There is no secrets manager in this project;
`.env.prod` itself, sitting on the VPS's disk, is where these values live.

`install-vps.sh` already does the generation step below for you on a first
run (skipped if `.env.prod` already exists) — this section is for
generating a fresh value later, e.g. to rotate one.

### Generating strong values

```bash
bun run prod:secrets            # prints a fresh POSTGRES_PASSWORD + SESSION_SECRET
bun run prod:secrets -- --write # writes them straight into infrastructure/docker/.env.prod
```

`--write` creates `.env.prod` from `.env.prod.example` first if it doesn't
exist yet, then replaces `POSTGRES_PASSWORD`, both places `DATABASE_URL`
repeats it, and `SESSION_SECRET` — safe to re-run later to rotate either
value (see the note below on rotating `POSTGRES_PASSWORD` on an *existing*
deploy, which needs one more step beyond this).

### Getting `.env.prod` onto the VPS

Pick whichever fits — both are normal, neither is more "correct":

**Generate it directly on the VPS** (no transfer needed):
```bash
ssh you@your-vps
cd /path/to/playani.me-v2
git pull
cp infrastructure/docker/.env.prod.example infrastructure/docker/.env.prod
bun run prod:secrets -- --write
nano infrastructure/docker/.env.prod   # fill in WEB_URL/API_URL if not playani.me,
                                         # Discord OAuth if you use it
```
(Needs Bun installed on the VPS just for this one command — or run the
generator locally and paste its printed output into `nano` instead.)

**Or generate locally, copy the file over:**
```bash
bun run prod:secrets -- --write   # writes infrastructure/docker/.env.prod locally
scp infrastructure/docker/.env.prod you@your-vps:/path/to/playani.me-v2/infrastructure/docker/.env.prod
```
`scp` (and `rsync`) both go over SSH, so the file is encrypted in transit
the same as everything else in that session — this is not materially less
safe than generating it on the VPS directly, just a different place the
plaintext briefly touches disk (your machine, instead of only the VPS's).

Don't email the file, paste it into a chat, or put it in a shared drive —
treat it the way you'd treat any file with plaintext database/session
credentials in it.

### Rotating a secret later

`SESSION_SECRET`: edit `.env.prod`, redeploy (`./deploy.sh`) — takes effect
immediately, and invalidates every existing session (everyone gets logged
out), which is the intended behavior after a suspected compromise.

`POSTGRES_PASSWORD`: editing `.env.prod` alone does **nothing** on an
existing deploy — Postgres only applies that variable the first time it
initializes an *empty* data directory. To actually rotate it:
```bash
docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml \
  --env-file infrastructure/docker/.env.prod --profile app exec postgres \
  psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'the-new-password'"
```
then update `POSTGRES_PASSWORD` and `DATABASE_URL` in `.env.prod` to match,
and redeploy.

## Connecting Drizzle Studio (or psql) to the VPS database

Postgres's `5432:5432` mapping is published on this VPS deliberately, so
`packages/database`'s `bun run db:studio` and a plain `psql` can reach it
from your local machine — not tunneled through Caddy or gated by IP.
**This means the database is reachable from the internet, protected only
by `POSTGRES_PASSWORD`.** That's a real widening of the VPS's attack
surface versus everything else in this stack (Caddy is the only other
public port, and it only reaches the app through `webserver`) — worth
knowing plainly rather than discovering later. If that tradeoff stops
being acceptable, the safer alternative is an SSH tunnel instead of a
published port:
```bash
ssh -L 5432:localhost:5432 you@your-vps
# then point Drizzle Studio / psql at localhost:5432 as usual, tunnel stays open
```
which needs no compose or firewall change — remove `ports: - '5432:5432'`
from `docker-compose.prod.yml`'s `postgres` service (it currently inherits
the base file's mapping unmodified) and use the tunnel instead.

To connect from your machine right now, with the port open:
```bash
# packages/database/.env or inline:
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD from .env.prod>@your-vps-ip:5432/playanime bun run db:studio
```

### Firewall

Ubuntu 24.04 ships `ufw` disabled by default; if you've enabled it, open
5432 alongside 80/443:
```bash
sudo ufw allow 5432/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```
If your VPS provider also has its own firewall/security-group layer
(DigitalOcean, Hetzner Cloud, AWS security groups, etc.), 5432 needs
opening there too — `ufw` alone doesn't reach a cloud-level firewall in
front of the host.

## Database persistence and backups

Postgres's data lives in the named Docker volume `playanime_pg` — it
survives container restarts, redeploys, and reboots on its own. It does
**not** survive `docker compose down -v`, `docker volume rm`, or the VPS's
disk itself failing, which is what backups are for.

`install-vps.sh` installs a daily cron job (03:00) running
`backup-postgres.sh`, which `pg_dump`s the database through the running
postgres container, gzips it into `infrastructure/docker/backups/`
(gitignored — these are real production data), and deletes anything older
than 14 days. Run it by hand any time, e.g. right before a risky migration:
```bash
./infrastructure/docker/backup-postgres.sh
```

**Restoring** a backup (meant for a genuine disaster — a fresh/empty
volume, not merging into a live one):
```bash
gunzip -c infrastructure/docker/backups/playanime-<timestamp>.sql.gz | \
  docker compose -f docker-compose.yml -f infrastructure/docker/docker-compose.prod.yml \
    --env-file infrastructure/docker/.env.prod --profile app exec -T postgres \
    psql -U postgres -d playanime
```

Backups only live on the VPS itself — for protection against the whole VPS
being lost (not just its disk), periodically copy
`infrastructure/docker/backups/` somewhere else (`rsync`/`scp` to another
machine, or upload to object storage). That's not automated here; add it
if/when it matters for your setup.
