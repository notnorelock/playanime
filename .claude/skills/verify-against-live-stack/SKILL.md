---
name: verify-against-live-stack
description: Confirm a PlayAnime fix actually works by checking it against the real running Postgres/Redis/API, not just by reading code or trusting the type-checker. Use after any bug fix or feature that touches data, not only when explicitly asked to test.
---

# Verifying against the live stack

On this project, "it typechecks" and "the logic looks right" have both
turned out to be insufficient more than once — see the
`trace-bugs-to-real-depth` memory. The dev stack (Postgres, Redis, and
usually the API) is normally already running; use it.

**Do not start, stop, or restart any of these processes yourself** unless
asked — see the dev-server-restart-policy memory and `AGENTS.md`. This skill
is about *reading* the state of an already-running stack, not managing it.

## Container names (this checkout)

```
playanime-v2-postgres-1
playanime-v2-redis-1
```

(Confirm with `docker ps --format "{{.Names}}" | grep playanime` if these
don't match — they're derived from the compose project name and can differ
per checkout.)

## Postgres — check the actual row

```
docker exec playanime-v2-postgres-1 psql -U postgres -d playanime -c "
  select <columns> from <table> where <condition>;
"
```

Useful for: confirming a migration applied and the column has the right
type/data, confirming a service function actually wrote what it claims to
(don't just check the HTTP response — check the row), confirming a
soft-deleted row's `deleted_at` is set rather than the row actually being
gone, confirming a foreign-key relationship resolves the way a mapper
assumes it does.

## Redis — check the actual key

```
docker exec playanime-v2-redis-1 redis-cli GET "<key>"
docker exec playanime-v2-redis-1 redis-cli KEYS "<pattern>*"
docker exec playanime-v2-redis-1 redis-cli TTL "<key>"
docker exec playanime-v2-redis-1 redis-cli EXISTS "<key>"
docker exec playanime-v2-redis-1 redis-cli DEL "<key>"
```

Keys are namespaced (`playanime:...` by default, from `REDIS_NAMESPACE`) via
`redisKeys.*` in `packages/redis/src/keys.ts` — if a key you expect to exist
doesn't show up under `KEYS "playanime:*"`, check whether the code that
wrote it built the key as a raw string instead of going through
`redisKeys.*` (this has been the actual bug more than once: a manually
seeded test key and the app's real key ended up different strings because
one had the namespace prefix and the other didn't).

## API — hit the actual endpoint

```
curl -s "http://localhost:4000/api/v1/<path>" -w "\nstatus=%{http_code}\n"
curl -s -X POST "http://localhost:4000/api/v1/<path>" \
  -H "Content-Type: application/json" \
  -d '{"field":"value"}' \
  -w "\nstatus=%{http_code}\n"
```

For a route that needs an authenticated session, either use `-c cookies.txt
-b cookies.txt` across a login call and the call under test, or accept that
an auth-required route correctly 401s without a cookie — that's often
sufficient to confirm the route exists and rejects anonymous callers
correctly, without needing real credentials.

Check both the response body's shape (does it match the contract?) and the
API's own log output if it's running in a visible terminal/log file — a 200
with the wrong shape, or a 500 that got swallowed into a generic error
message client-side, both look identical from the HTTP response alone but
mean very different things.

## Reproducing a scenario you can't trigger through the real flow

Some flows (an OAuth callback, a rate-limited endpoint hit repeatedly) are
awkward to drive end-to-end via curl. Seed the intermediate state directly —
e.g. write a Redis key in the exact shape the real code would have written,
then call the endpoint that's supposed to consume it — to isolate whether
the bug is in the write path or the read path. Match the app's actual key/
row shape exactly (same namespace prefix, same field names) or the "test"
will pass/fail for a reason unrelated to the real bug.

## Cleanup

**Undo any test data before finishing.** This project's convention (see
several past sessions) is to delete a throwaway account's rows across every
table it touched (`oauth_accounts`, `sessions`, `user_preferences`,
`profiles`, `users`, in that FK order to avoid a constraint error), remove a
manually-seeded Redis key, and restore a real row (e.g. a rating or library
entry) to whatever state it was in before you touched it for testing — don't
leave synthetic data sitting in a database the user might look at next.
