# PlayAnime

Polish anime database, discovery and community platform.

**PlayAnime does not host video.** It is a catalogue, a library tracker and a
community layer. Playable content is linked to third-party providers that host
it themselves, under moderation and with a rights attestation from whoever
submitted the link.

---

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| [Bun](https://bun.sh) | ≥ 1.3 | Runtime, package manager and test runner |
| Docker + Compose | ≥ 24 | PostgreSQL and Redis for local development |
| Node | ≥ 20 | Only for tooling that shells out to it |

## Getting started

```bash
git clone <repository> playanime
cd playanime

cp .env.example .env     # the defaults work for local development
bun install

bun run docker:up                        # PostgreSQL + Redis
bun run scripts/wait-for-services.ts     # waits for them to accept connections
bun run db:migrate
bun run db:seed                          # 12 titles, genres, studios, episodes

bun run dev                              # API on :4000, web on :3000
```

Or the whole sequence in one step:

```bash
bun run setup && bun run dev
```

Open <http://localhost:3000>. Check <http://localhost:4000/api/v1/health> — it
queries PostgreSQL and Redis rather than reporting a hardcoded `ok`.

---

## Architecture

### Package tiers

Packages are organized into tiers, and **a package may import only from a
strictly lower tier**. That makes the dependency graph acyclic by construction
rather than by convention, and it is enforced by lint
([`packages/eslint-config/boundaries.js`](packages/eslint-config/boundaries.js))
rather than left to review.

```
Tier 0   shared                              (no workspace dependencies)
Tier 1   contracts, config                   → shared
Tier 2   logger                              → shared, config
Tier 3   database, redis                     → shared, config, logger
Tier 4   auth, realtime, player, ui,
         external-media                      → tiers 0–3
Tier 5   api, web                            → tiers 0–4, never each other
```

Adding a package means adding it to that table. If that feels like friction, it
is the rule working: a new package is an architectural decision.

### Packages

| Package | Responsibility |
| --- | --- |
| [`shared`](packages/shared) | Error model, `Result`, branded ids, pagination, Polish-aware slugify. Zero dependencies — see its [charter](packages/shared/README.md) |
| [`contracts`](packages/contracts) | The wire format. TypeBox schemas consumed by both API and web |
| [`config`](packages/config) | Environment validation. The only place `process.env` is read |
| [`logger`](packages/logger) | Structured logging with centralized secret redaction |
| [`database`](packages/database) | Drizzle schema, migrations, repositories, seeds |
| [`redis`](packages/redis) | Keyspace, cache, rate limiting, distributed locks |
| [`auth`](packages/auth) | Sessions, password hashing, CSRF, authorization guards |
| [`external-media`](packages/external-media) | Third-party provider registry — see its [README](packages/external-media/README.md) |
| [`ui`](packages/ui) | Design system. Generic components only; nothing that knows what an anime is |
| [`api`](packages/api) | Elysia application |
| [`web`](packages/web) | SolidJS application |

---

## Key decisions

**Contracts are not database models.** A Drizzle row describes storage; a
contract describes what the public API promises. They drift deliberately — a
user row has `passwordHash` and a soft-delete flag that no client may see.
Mapping happens in an explicit `toPublicX()` function, which makes leaking a
column a visible review error rather than an automatic consequence of adding
one. `contracts` sits at tier 1 and cannot import `database` at all.

**TypeBox rather than Zod for the wire format.** Elysia validates with TypeBox
natively, so one schema serves runtime validation, static types on both sides,
and OpenAPI generation. Zod is still used in `config`, where none of that
applies.

**Cursor pagination, not offset.** `OFFSET 50000` still scans 50,000 rows, and
offsets skip or duplicate entries when the underlying set changes between
requests — unacceptable for an infinite-scrolling catalogue.

**Server-side sessions, not JWTs.** Revocation has to be immediate: a stolen
device signed out, or a suspended account, cannot wait for a token to expire.
The client holds an opaque token; only its SHA-256 is stored.

**Tailwind v4 CSS-first, alongside SCSS.** No `tailwind.config.js` — v4 does not
need one, and a JS mirror of the tokens is how the two drift. Tailwind carries
layout and one-off spacing where colocation helps; SCSS carries the token
system, nested state, keyframes, and the compositions that would otherwise be
twelve-utility chains repeated across the codebase.

**The catalogue is not `Anime → Episode`.** Franchises are messy: films and
spin-offs share characters but no season ordering, and a split cour breaks for a
quarter mid-season. The model is
`franchise → anime → season → cour → episode`, with the middle layers nullable.

---

## External media

PlayAnime links to third-party providers; it never serves video bytes. The rules
are architectural, not stylistic:

- No extraction, scraping or reconstruction of direct media URLs.
- No circumvention of DRM, authentication, ACLs, resource keys, quotas or
  hotlink protection.
- No proxying of third-party video through PlayAnime servers.

A provider may render in an iframe only with a **documented, publicly supported**
embed mechanism. Providers whose integration has not been verified resolve to an
off-site link — a correct outcome, not a gap to engineer around.

| Provider | Policy | Mechanism |
| --- | --- | --- |
| YouTube | embed | Documented IFrame Player API on `youtube-nocookie.com` |
| Google Drive | embed | Documented `/file/d/{id}/preview` viewer |
| Rumble | embed | Documented `/embed/{id}/` player and oEmbed |
| CDA, Vidoza, MP4Upload, Sibnet | link-only | Embed terms not yet verified |

Every submitted source carries a rights attestation, stored verbatim with a
timestamp, and enters a moderation queue before any viewer sees it.

---

## Commands

```bash
bun run dev              # API and web together
bun run dev:api          # API only
bun run dev:web          # web only

bun run build            # every package
bun run typecheck        # project-wide
bun run lint             # ESLint, type-aware
bun run test             # Bun test runner

bun run db:generate      # generate a migration from schema changes
bun run db:migrate       # apply pending migrations
bun run db:push          # push schema without a migration (development only)
bun run db:studio        # Drizzle Studio
bun run db:seed          # development data

bun run docker:up        # PostgreSQL + Redis
bun run docker:down      # stop
bun run docker:logs      # follow
bun run docker:reset     # destroy volumes and restart
```

---

## Testing

`bun test` runs unit and integration tests. The Redis tests exercise a **live**
server, because the bugs they prevent — races between concurrent rate-limit
callers, a lock released by the wrong owner — only appear against the real
thing. Start Docker before running them.

Tests concentrate on behaviour that is expensive to get wrong: error
serialization (that an internal message never reaches a client), environment
validation, log redaction, provider URL parsing, look-alike hostname rejection,
iframe injection resistance, and the authorization guards.

---

## Deployment

Production images are in [`infrastructure/docker/`](infrastructure/docker/).
Both are multi-stage; the web runtime contains no JavaScript runtime at all.

```bash
docker build -f infrastructure/docker/Dockerfile.api -t playanime-api .
docker build -f infrastructure/docker/Dockerfile.web -t playanime-web .
```

Before deploying:

- **Generate a real `SESSION_SECRET`** (`openssl rand -base64 48`). Config
  validation rejects the development placeholder when `NODE_ENV=production`.
- **Set `TRUST_PROXY_HOPS`** to the actual number of proxies in front of the
  API. Leaving it at `0` behind a load balancer means rate limiting sees the
  proxy; setting it too high lets a caller spoof their IP through
  `X-Forwarded-For`.
- **Run migrations as a deploy step**, not at application boot — several
  replicas starting at once would race to alter the same schema.
- **Update the CSP `frame-src`** in [`infrastructure/nginx/web.conf`](infrastructure/nginx/web.conf)
  whenever the provider allowlist changes. It is derived from
  `ProviderRegistry.frameSrcOrigins()` but currently maintained by hand.

Note that `VITE_API_URL` is baked into the web bundle at build time, so a bundle
is environment-specific.

---

## Legal

The legal pages under `/legal/` are **placeholders and require review by a
qualified lawyer before any production deployment.** Nothing in this repository
constitutes legal advice, and hosting third-party links carries obligations that
vary by jurisdiction.

A functioning takedown path exists: reports can be filed anonymously at
`/zglos`, copyright complaints route to a separate queue, and every moderation
decision is recorded in an append-only audit log.
