# @playanime/realtime

Tier-4 package. Depends only on tiers 0–3 (`shared`, `contracts`, `config`,
`redis`, `logger`) — deliberately not `@playanime/auth`, also tier 4;
socket authentication happens in `packages/api` (which can see both) by
reusing the existing `sessionContext`/`resolveSession` path before handing
a connection off to this package, not inside it.

## Charter

Session-revocation and cross-device playback-handoff signaling over a
single WebSocket, and the Redis pub/sub plumbing that lets one API instance
notify a socket held on another. **Not** the watch-party protocol —
`packages/contracts/src/realtime/events.ts`'s `ClientEvent`/`ServerEvent`
pair, and the `watch_parties` schema/Redis keys they're meant for, describe
a real but larger feature (many members, one shared room) that has no
server implementation yet. This package intentionally does not attempt it.

### What belongs here

- The in-process socket registry (`registry.ts`) — which session ids this
  API instance currently holds an open socket for.
- Redis pub/sub fanout (`pubsub.ts`) — publishing an account-realtime event,
  and a ref-counted per-user subscribe so an instance holding none of a
  user's sockets never subscribes to that user's channel at all.
- Handlers (`handlers/`) that turn a domain action (a session got revoked)
  into a published event. The domain action itself — the actual database
  write — happens in the caller (`@playanime/auth`, wired in from
  `packages/api`), not here.

### What does NOT belong here

- Business logic for *why* something is being broadcast (a revoke reason, a
  handoff's ownership rules). That lives with the feature that owns it.
- The actual Elysia `.ws()` route or its authentication. That is
  `packages/api/src/modules/realtime/realtime.controller.ts` — it can
  import both `@playanime/auth` and this package; this package imports
  neither Elysia nor `@playanime/auth`.
- Watch-party room state. See the charter note above.

## Why a package, not a plugin inside `packages/api`

The tier system already reserves `realtime` as an allowed tier-4 name
(`packages/eslint-config/boundaries.js`), the same slot `auth` and `player`
occupy — mechanics that are framework-agnostic and worth testing without an
HTTP server belong at this tier, with `packages/api` mounting a thin route
that delegates to it. This also means a future non-`packages/api` process
(a worker, the Go `services/webserver`) could publish a realtime event
without depending on all of `packages/api`.
