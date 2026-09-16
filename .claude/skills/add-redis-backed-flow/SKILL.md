---
name: add-redis-backed-flow
description: Build a multi-step server flow on PlayAnime that needs short-lived intermediate state between requests — an OAuth-style redirect, an email/2FA challenge, a pending confirmation. Use whenever a task needs to pass state between two HTTP requests that a client can't be trusted to hold itself.
---

# A Redis-backed multi-step flow

This codebase already has three real examples of this exact shape: Discord
OAuth's state token (`packages/auth/src/oauth/service.ts`), 2FA's login
challenge token, and 2FA's pending-signup token. All three follow the same
structure — copy it rather than inventing a new one.

## The shape

1. **A random opaque token**, generated with `newToken()` from
   `@playanime/shared` (URL-safe, CSPRNG-backed) — never a predictable or
   sequential id for something that gates a security-relevant next step.

2. **A `redisKeys.*` builder for it**, added to
   `packages/redis/src/keys.ts`, never a raw template string built inline at
   the call site. This is not optional style — a key built outside
   `redisKeys.*` silently skips the `REDIS_NAMESPACE` prefix every other key
   gets, which has been a real bug in this project (a manually-seeded test
   key and the app's real key didn't match because one had the prefix and
   the other didn't).

   ```ts
   // in packages/redis/src/keys.ts, inside the redisKeys object:
   myFlowChallenge: (token: string): string =>
     namespacedKey(['my-flow', 'challenge', segment(token)]),
   ```

3. **Write the state with `cacheSet(key, value, ttlSeconds, redis())`**, a
   short TTL matched to how long the step should realistically take (5
   minutes for an OAuth/login-style round trip, 10 minutes for something
   requiring the user to look something up first, like a signup completion
   form). Never store anything you wouldn't want sitting in Redis in
   plaintext — a secret being carried through this flow should already be
   encrypted before it goes in (see `packages/auth/src/twofactor/encryption.ts`
   for the pattern: AES-256-GCM keyed off `SESSION_SECRET`).

4. **Read it back with `cacheGet<T>(key, redis())`** in the step that
   consumes it. Treat `null` as "expired, invalid, or already used" — a
   single generic error message, not a distinction the caller can use to
   fingerprint whether a token ever existed.

5. **Delete it only after the step that consumes it actually succeeds** —
   not before. This was a real bug in this project: the 2FA signup-
   completion token was originally deleted *before* checking whether the
   chosen username was available, so a validation failure (a taken
   username) burned the one-time token and any retry hit "session expired"
   instead of a chance to pick a different username. Consume-on-success,
   not consume-on-attempt.

   ```ts
   const state = await cacheGet<MyFlowState>(redisKeys.myFlowChallenge(token), redis());
   if (state === null) throw new AppError('...', { status: 400, expose: true });

   // ... do the actual work that can fail (uniqueness checks, etc.) ...

   await redis().del(redisKeys.myFlowChallenge(token)); // only once it succeeded
   ```

6. **If the flow needs to survive a full login/session boundary** (like
   "remember this device" skipping a future 2FA prompt), that's a *separate*
   longer-lived, database-backed token with only its hash stored — see
   `trusted_devices` and `hashSessionToken()` in
   `packages/auth/src/session.ts` for the pattern (same reasoning as
   session cookies: a database leak must not yield a usable token). Don't
   try to make a short-TTL Redis challenge token also serve this purpose.

## Verification

Use the `verify-against-live-stack` skill's Redis section to seed and
inspect the intermediate state directly — this is the most reliable way to
test a multi-step flow's failure paths (expired token, wrong code, retried
after a partial failure) without driving the whole real flow (e.g. an actual
OAuth provider round trip) end to end.
