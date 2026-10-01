# PlayAnime

A fansub/anime-tracking platform: a Vue 3 SPA talking to an Elysia/Bun API,
backed by Postgres and Redis. Catalogue browsing, episode playback via
external sources, library tracking, ratings and comments, a translator-group
system for fansub credits, and moderator/admin tooling.

## Status

**Development on this project has stopped.** It is not maintained, not
deployed, and should not be treated as production-ready or actively
supported software.

This repository was a collaboration between the original author and a
second contributor known as **StarDust**. The financial/ownership split
that was agreed for the project was not honored, and work contributed to
this codebase was used without the agreed compensation or attribution.
The author was subsequently removed from the project's Discord server and
cut off from any further information about its status. This section exists
so that anyone encountering this codebase has that context; it is a factual
account of what happened, not a request for action from anyone reading it.

## Architecture

```
Tier 0  shared                          no workspace deps
Tier 1  contracts, config             -> shared
Tier 2  logger                        -> shared, config
Tier 3  database, redis               -> shared, config, logger
Tier 4  auth, realtime, player, ui,
        external-media                -> tiers 0-3
Tier 5  api, web                      -> tiers 0-4, never each other
```

- **`packages/web`** — Vue 3 SPA, file-based routing.
- **`packages/api`** — Elysia/Bun HTTP API.
- **`packages/contracts`** — TypeBox schemas shared by both ends; every
  request/response shape is defined once here.
- **`packages/database`** — Drizzle ORM schema, migrations, repositories.
- **`services/cdn`** — a small static file server for uploaded media.
- **`services/webserver`** — a Go binary alternative to nginx for serving
  the built web bundle in production (SEO meta tags, SPA fallback).

See `AGENTS.md` for the full architectural writeup (request flow,
conventions, gotchas specific to this codebase).

## Requirements

- [Bun](https://bun.sh) `>=1.3.0`
- [Docker](https://www.docker.com/) (for Postgres and Redis locally)
- [Go](https://go.dev/) (only if you run `services/webserver` or
  `services/cdn` directly instead of via Docker)

## Setup

```sh
bun install
cp .env.example .env
cp packages/web/.env.example packages/web/.env
```

Fill in `.env`:
- `TURNSTILE_SECRET_KEY` is required — registration and the contact form
  refuse every request without it. Get a site/secret key pair at
  [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile).
- Everything else in `.env.example` is documented inline; most integrations
  (Discord OAuth, DeepL, Resend, Byse) are optional and simply disable the
  feature they back when left unset.

Fill in `packages/web/.env`:
- `VITE_TURNSTILE_SITE_KEY` — the public half of the Turnstile pair above.

Start Postgres and Redis:

```sh
bun run docker:up
```

Apply migrations and seed data:

```sh
bun run db:migrate
bun run db:seed
```

Run the app:

```sh
bun run dev
```

This starts both the API (`:4000`) and the web dev server (`:3000`)
together. Use `bun run dev:api` / `bun run dev:web` to run just one.

Alternatively, `bun run setup` (`scripts/setup-full-stack.ts`) scripts the
above for a fresh checkout.

## Common scripts

```sh
bun run typecheck   # tsc --build across all tiers, then vue-tsc for web
bun test             # every package with a tests/ dir
bun run lint          # eslint .
bun run format         # prettier --write
```

Database:

```sh
bun run db:generate   # generate a migration from schema changes
bun run db:migrate    # apply pending migrations
bun run db:studio     # Drizzle Studio
bun run db:seed       # seed dev data
```

## Production deploy

A single-VPS Docker Compose deploy lives under `infrastructure/docker/` —
see `AGENTS.md`'s "Production VPS deploy" section and
`infrastructure/docker/README.md` for the full setup (`install-vps.sh` for
first-time bootstrap, `deploy.sh` for subsequent deploys, Caddy for TLS).

## License

No license has been specified for this project.
