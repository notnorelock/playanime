# AGENTS.md

Instructions for any AI coding agent working in this repository. This is the
canonical file — `CLAUDE.md` and other tool-specific instruction files in this
repo point back to it rather than repeating it.

## What this is

PlayAnime: a fansub/anime-tracking platform. A Vue 3 SPA (`packages/web`)
talking to an Elysia/Bun API (`packages/api`) backed by Postgres (Drizzle ORM)
and Redis. Contracts-first: every wire shape is a TypeBox schema in
`packages/contracts`, shared by both ends so a payload can't drift out of sync
silently.

## Before you touch anything

1. **Read the package's own README first**, if it has one
   (`packages/shared/README.md` is the model to match — charter, admission
   rule, what does *not* belong there). Package-level docs win over this file
   when they're more specific.
2. **Find the nearest existing pattern and match it.** This codebase has a
   consistent style — repository → service → controller on the backend,
   composable + API client module on the frontend — and a new feature that
   doesn't fit that shape is usually solving the problem at the wrong layer.
3. **Trace data to its actual source before changing a type.** A field that
   looks unused in one file is often read three modules away through a mapper.
   Grep the whole monorepo, not just the file you're editing.

## Architecture

### Package tiers (enforced by ESLint, not just convention)

```
Tier 0  shared                          no workspace deps
Tier 1  contracts, config             -> shared
Tier 2  logger                        -> shared, config
Tier 3  database, redis               -> shared, config, logger
Tier 4  auth, realtime, player, ui,
        external-media                -> tiers 0-3
Tier 5  api, web                      -> tiers 0-4, never each other
```

A package may only import from strictly lower tiers. This is defined in
`packages/eslint-config/boundaries.js` and enforced by `no-restricted-imports`
— violating it fails lint, not just review. `api` and `web` may never import
each other; everything they share crosses through `contracts`.

### The contracts-first rule

Every request/response shape is a TypeBox schema in `packages/contracts`,
grouped by domain (`auth`, `anime`, `catalogue`, `social`, `media`, `library`,
...). Backend and frontend both import the same `Static<typeof X>` type. When
a field changes, it changes in contracts first, and the compiler finds every
call site that needs updating — that propagation is the entire point of this
architecture. Never hand-write a duplicate interface on one side "to save a
step."

### Backend request flow

```
contracts (shape) → repository (Drizzle query) → service (business rules,
  authorization) → controller (Elysia route, wires session/body/params)
```

- **Repositories** (`packages/database/src/repositories/`) hold Drizzle
  queries only — no business logic, no authorization decisions. A repository
  method returns rows shaped close to the schema; row→DTO mapping happens one
  layer up.
- **Services** (`packages/api/src/modules/<domain>/<domain>.service.ts`) hold
  business rules and authorization. A service function takes plain arguments
  (never the raw Elysia context) so it's callable from a script or a test
  without spinning up HTTP.
- **Mappers** (`<domain>.mapper.ts`) are the *only* place a database row
  becomes a DTO. Every exposed field is an explicit assignment — never spread
  a row into a response, or the next column someone adds leaks by accident.
- **Controllers** (`<domain>.controller.ts`) are thin: parse params/body via
  the contract schema, call the service, return its result. Business logic in
  a controller is a sign it's in the wrong layer.

### Frontend

- `packages/web/src/api/<domain>.ts` — one `http.*` call per method, typed
  against the contract. Never call `fetch` directly from a component.
- `packages/web/src/store/*.ts` — Pinia, one store per cross-cutting concern
  (auth, settings). Not every piece of state needs a store; component-local
  `ref` is preferred when nothing else needs it.
- `packages/web/src/models/*.ts` — the adapter layer between a DTO and what a
  component renders (`toAnimeCardModel`, `pickTitle`, etc.). Convert once
  here — display-scale conversions, locale-title-picking, null-coalescing —
  rather than in every component that touches the data. If two components
  independently do the same `?? fallback` dance on a DTO field, that logic
  belongs in a model function instead.
- `packages/web/src/composables/*.ts` — cross-component reactive logic.
  Several existing ones use a **module-level singleton** (`ref` declared
  outside the composable function, shared across every call site) specifically
  to avoid redundant API calls when multiple sibling components ask the same
  question on one page (see `useCataloguePermissions.ts`). Don't reach for
  this by default — most composables should be per-instance — but recognize
  the pattern when you see it and don't "fix" it into a fresh ref per call.
- File-based routing (`unplugin-vue-router`): a view's route is derived from
  its path under `src/views/`. `definePage({ meta: {...} })` sets nav
  visibility, auth requirements, and icon.

### Visual design

Dark, glassmorphic, orange-branded (`--color-primary: #f47521`). Full color
tokens, the four `glass-*` blur tiers and when to use which, `Button`/`Card`
variant meanings, the loading/error/empty three-state shape every data
component follows, and spacing/typography/icon conventions are documented
in `.claude/skills/design-frontend-ui/SKILL.md` — read it before adding or
restyling any UI, not only when asked to "design" something. The short
version: reach for `text-primary` (the brand orange) for anything
confirming *this app's* action, never a neutral accent color for that; a
`glass-*` element nested inside another `glass-*` element blurs the wrong
thing (see the skill for why, and how the sidebar's account flyout works
around it via `Teleport`).

### Session/auth model

- HttpOnly session cookie, opaque token, only its SHA-256 hash stored
  (`sessions.token_hash`) — a database leak yields no usable sessions.
- Double-submit CSRF: a separate **readable** cookie
  (`playanime_csrf`) echoed back as the `x-csrf-token` header on mutations.
- 2FA (TOTP, hand-rolled RFC 6238, no dependency) gates session issuance, not
  the password check — `login()` always runs the full credential check
  regardless of whether 2FA is enabled, so response timing can't reveal which
  accounts have it on. A password check that passes on a 2FA account returns
  `{ kind: 'two_factor_required', challengeToken }`, not a session.
- Discord OAuth is a real server-side redirect flow (`GET /auth/discord` →
  Discord → `GET /auth/discord/callback`), not a client SDK. New account vs.
  existing account vs. "link to the account I'm already signed into" is
  decided server-side from whether the caller already has a session when the
  flow starts.
- Every Redis key goes through `redisKeys.*` in `packages/redis/src/keys.ts`,
  which applies the `REDIS_NAMESPACE` prefix. **Never build a Redis key as a
  raw template string** — it silently escapes the namespace and collides with
  other environments sharing the instance. Add a new `redisKeys.foo()`
  builder instead of inlining a key anywhere it's used.

## Non-negotiable conventions

- **Cursor pagination everywhere, never offset.** Every list endpoint takes
  `{ cursor?, limit }` and returns `{ items, nextCursor, hasMore }`
  (`CursorPageOf` in contracts). An `offset`/`page` parameter on a new
  endpoint is a bug.
- **Soft deletes on catalogue data.** Anime, episodes — never hard-deleted.
  Progress, comments, ratings, and sources reference these rows, and a hard
  delete would silently orphan a viewer's history. Filter with
  `isNull(table.deletedAt)`, never actually `DELETE FROM`.
- **snake_case in Postgres, camelCase everywhere else.** Drizzle's `casing:
  'snake_case'` config handles the translation; column names in `schema/*.ts`
  are still written camelCase and Drizzle converts them.
- **Branded ID types** (`UserId`, `AnimeId`, etc. in `@playanime/shared`) at
  trust boundaries, so `getAnime(userId)` is a type error, not a runtime bug
  found in production.
- **Every privileged mutation writes an audit row** to
  `moderation_audit_log` — actor, action, previous/new status, reason. If
  you're adding a moderator/admin action, check whether it needs one.
- **No comments explaining *what* the code does.** Identifiers should already
  make that obvious. A comment earns its place only by explaining *why* —
  a non-obvious constraint, a workaround for a specific bug, a decision that
  would surprise the next reader. This repo's existing comments are the
  calibration: read a few before writing your own.
- **Never silently narrow, widen, or reinterpret a request's scope.** If a
  bug report turns out to reveal a second, deeper bug (this has happened
  more than once in this codebase — see `MEMORY.md`), say so and finish
  both rather than quietly picking one.

## Things that will bite you specifically in this repo (Windows dev environment)

- **`bun --watch` does not reliably pick up changes in sibling workspace
  packages.** If you edit `packages/auth/src/*.ts` while `packages/api`'s dev
  server is running, the API process usually needs a manual restart to see
  it — its watcher only reliably covers its own `src/`. Don't trust "it must
  be hot-reloaded" when a fix doesn't seem to take effect; check by curling
  the endpoint and comparing to what the new code should do.
- **Two processes can bind the same port without the second one erroring**,
  because `SO_EXCLUSIVEADDRUSE` isn't set — so a "restart" that doesn't kill
  the old process first leaves a stale server silently answering requests
  alongside the new one. Always check `netstat -ano | grep :<port>` for
  *every* PID listening before trusting a restart, and kill all of them.
- **Root `.env` is not auto-loaded by every script.** `drizzle-kit` (via
  `packages/database/drizzle.config.ts`) reads `DATABASE_URL` straight from
  `process.env` with no dotenv loading of its own — pass it inline
  (`DATABASE_URL=... bun run generate`) when running database commands
  directly from `packages/database`, or run through the root `bun run
  db:generate` script instead, which does the right thing.
- **`bun run dev` at the repo root starts both the API and web dev servers
  together** (API on port 4000, web on port 3000), via two `--filter` flags
  on one `bun run` invocation. `bun run dev:api` / `bun run dev:web` start
  just one — reach for these when you only need to restart one side (see
  the `bun --watch` gotcha above: editing a shared package often only needs
  the API restarted, not the web server too).

## `services/webserver` — production alternative to `bun run dev:web`

A Go/Gin binary that serves the built `packages/web` bundle, an alternative
front door to `infrastructure/docker/Dockerfile.web` (nginx): same static
serving, `/api` proxy, and SPA fallback, plus server-injected OG/meta tags
for crawlers on detail pages and staff-only `.map` access. It is **not**
part of `bun run dev` — Vue's own dev server already does hot reload; this
only matters once there's a built `dist/` to serve. See
`services/webserver/README.md` for the full route list and config.

- `bun run preview` builds `packages/web` and runs this server against it;
  `bun run preview:server` runs just the server against an existing build.
- `docker compose --profile app up -d --build` builds and runs the full
  `api` + `web` (nginx) + `webserver` stack alongside `postgres`/`redis` —
  gated behind the `app` profile so it never starts on a plain `docker
  compose up -d` (this project's normal Postgres/Redis-only dev flow).
- **There is no API key or bearer-token auth anywhere in this app.**
  Everything this server calls on the backend (anime/translators/profiles
  by slug, episodes by id, `auth/me`) is either public or cookie-authenticated
  — it forwards the real session cookie, never invents credentials. If you
  see `BackendAPIKey`/`X-API-Key`/`BACKEND_API_KEY` reappear anywhere, that's
  a regression back to a stale assumption from this server's original,
  pre-adaptation code — remove it, don't wire it up further.

## Verification checklist before calling anything done

Run from the repo root:

```
bun run typecheck   # tsc --build across all tiers, then vue-tsc for web
bun test             # bun test, every package with a tests/ dir
bun run lint          # eslint . — expect the pre-existing baseline (see below)
```

- **Lint baseline**: at the time of writing there are **18 pre-existing lint
  errors** in packages this work didn't touch (`external-media`,
  `error-handler.ts`). This is a known, accepted baseline — don't try to fix
  them as a drive-by, and don't treat "lint isn't 100% clean" as a sign your
  own change broke something. Compare the count and the file list before and
  after your change; new errors in files you touched are yours to fix, the
  baseline isn't.
- A schema change needs a generated + applied migration
  (`bun run db:generate` then `bun run db:migrate`), not a hand-written SQL
  file. Check the generated SQL before applying it — it should be exactly the
  change you intended (one `ALTER TABLE`, not an unrelated column getting
  dropped because a rename looked like a drop+add to the diff).
- For a UI change, actually load it in a browser if you have a way to verify
  the running app; typecheck and lint prove correctness, not that a feature
  works. If you cannot run the app yourself, say so explicitly rather than
  claiming the feature is confirmed working.

## Don't

- Don't add a new npm/bun dependency for something this small a codebase
  already does by hand elsewhere (e.g. TOTP, Discord OAuth — both hand-rolled
  here on purpose, see `packages/auth/src/twofactor/` and `oauth/`). A
  dependency is justified when the thing is genuinely complex or
  security-sensitive enough that reimplementing it is the actual risk (see
  `qrcode` — added because rendering a QR code is real, fiddly work, not
  because it was easier than not adding a dependency).
- Don't add `offset`/`page`-based pagination, ever.
- Don't hard-delete a row from a catalogue or social table.
- Don't build a Redis key as a raw string outside `redisKeys.*`.
- Don't restart a dev server without checking for and killing every existing
  PID on that port first.
- Don't treat "the type compiles" as proof a migration is safe — read the
  generated SQL.
