# PlayAnime Go webserver

An alternative front door for the built `packages/web` bundle — same job as
`infrastructure/docker/Dockerfile.web` (nginx: serve the static bundle,
proxy `/api` to the backend, SPA fallback), plus two things nginx can't do:

- **Dynamic OG/meta tags** for crawlers on detail pages (anime, watch,
  translator, profile) — fetched server-side from the real backend and
  injected into `index.html` before it's sent.
- **Staff-only source maps** — `.map` files under `/assets` and `/js`
  require a signed-in moderator/admin session in production.

Run one or the other (nginx or this), not both, in front of the same build.

## Routes

All params match the frontend's actual route params in
`packages/web/src/views/**/[param].vue` exactly — everything is addressed
by slug or username, never a numeric id.

- `GET /health` — health check
- `GET /anime/:slug` — anime detail, SEO
- `GET /watch/:episodeId` — watch page, SEO (no separate anime id — the
  backend resolves the anime from the episode)
- `GET /translator/:slug` — translator group profile, SEO
- `GET /profile/:username` — user profile, SEO
- `GET /legal/:file` — serves either the SPA page (`/legal/tos`) or the raw
  markdown asset it fetches client-side (`/legal/tos_en.md`, copied from
  `packages/web/public/legal` into the build); told apart by filename shape
- `GET /assets/*`, `GET /js/*` — static bundle assets (`.map` gated to staff
  in production, when `ENABLE_SOURCE_MAPS=true`)
- `GET /api/*` — proxied to the backend, forwarding all original headers
  (including the session cookie)
- every other known SPA route (`/browse`, `/login`, `/settings`, etc. — see
  `spaRoutes` in `router/router.go`) and any unmatched path — SPA shell;
  Vue Router's own `[...all].vue` decides whether it's a real 404

## Auth

There is no API key and no bearer token anywhere in this app. Sessions are
an opaque, HttpOnly cookie (`SESSION_COOKIE_NAME`, `playanime_session` by
default) — this server never verifies it locally, it forwards whatever
cookie the browser sent to `GET /api/v1/auth/me` and trusts the backend's
answer (see `services/auth.go`). Source map access checks that response's
role is at least `moderator`.

## Setup (local, without Docker)

```bash
go mod download
cp .env.example .env
bun run --filter '@playanime/web' build   # from the repo root
go run .
```

Or via the root `package.json`: `bun run preview` builds the web bundle and
starts this server together; `bun run preview:server` starts just the
server against an already-built `dist/`.

## Configuration

Environment variables (see `.env.example`):

- `PORT` — server port (default `3000`)
- `ENV` — `production` or `development`
- `BACKEND_URL` — API base URL (default `http://localhost:4000`)
- `SESSION_COOKIE_NAME` — must match the API's own `SESSION_COOKIE_NAME`
  (default `playanime_session`)
- `CLIENT_DIST_PATH` — path to the built web bundle (default
  `../../packages/web/dist`, relative to this directory)
- `ENABLE_SOURCE_MAPS` — gate `.map` files to staff sessions in production
  (default `true`)

## Docker

```bash
# from the repo root — brings up api + web (nginx) + webserver + postgres + redis
docker compose --profile app up -d --build
```

`infrastructure/docker/Dockerfile.webserver` builds the web bundle and this
binary in separate stages, then ships only the binary and the static files
in an Alpine runtime image, running as a non-root user — the same shape as
`Dockerfile.api`. In `docker-compose.yml`, `api`/`web`/`webserver` are
behind the `app` profile so the project's normal dev flow
(`bun run docker:up`, Postgres/Redis only — everything else via
`bun run dev`) is unaffected.

## Development

```bash
ENV=development go run .
```

Enables Gin's debug router log and skips the staff-only gate on source maps
(`ENABLE_SOURCE_MAPS`/`AdminOnly` only apply when `ENV=production`).

## Tests

```bash
go test ./...
```

`router/router_test.go` calls `router.Setup()` under `recover()` — Gin
panics at router-build time (not request time, and not `go build` time) if
two registered routes create a conflicting node in its radix tree, e.g. a
static file group and a `:param` route at the same prefix. This test exists
because that exact conflict happened once already, between a stale
`r.Static("/legal", ...)` and the newer `/legal/:file` route.
