/**
 * The Redis keyspace.
 *
 * Every key the platform writes is constructed here. Scattering
 * `redis.get('user:' + id)` through the codebase makes the keyspace impossible
 * to audit, impossible to migrate, and guarantees two modules will eventually
 * disagree about a separator.
 *
 * Conventions:
 *   - `<namespace>:<domain>:<identifier>[:<facet>]`
 *   - lowercase, colon-separated, no spaces
 *   - identifiers are UUIDs or slugs, never user-supplied free text
 */

import { namespacedKey } from './client.js';

/** Rejects a key segment that would corrupt the keyspace. */
function segment(value: string): string {
  if (value.length === 0 || value.includes(':') || /\s/.test(value)) {
    throw new Error(`Invalid Redis key segment: ${JSON.stringify(value)}`);
  }
  return value;
}

export const redisKeys = {
  /* ---------------------------------------------------------------------- */
  /* Sessions and auth                                                       */
  /* ---------------------------------------------------------------------- */

  /** Cached session lookup, avoiding a Postgres round trip per request. */
  session: (tokenHash: string): string => namespacedKey(['session', segment(tokenHash)]),

  /** Set of a user's active session ids, for "sign out everywhere". */
  userSessions: (userId: string): string => namespacedKey(['user', segment(userId), 'sessions']),

  /** CSRF token bound to a session. */
  csrf: (sessionId: string): string => namespacedKey(['csrf', segment(sessionId)]),

  /** CSRF-equivalent state for an in-flight Discord OAuth round trip. */
  discordOAuthState: (state: string): string =>
    namespacedKey(['oauth', 'discord', 'state', segment(state)]),

  /** A Discord identity waiting for the visitor to pick a username. */
  discordPendingSignup: (token: string): string =>
    namespacedKey(['oauth', 'discord', 'pending-signup', segment(token)]),

  /** A password check that passed but is waiting on a TOTP or recovery code. */
  twoFactorChallenge: (token: string): string =>
    namespacedKey(['2fa', 'challenge', segment(token)]),

  /** A TOTP setup awaiting confirmation with a real code before it can be enabled. */
  twoFactorPendingSetup: (userId: string): string =>
    namespacedKey(['2fa', 'pending-setup', segment(userId)]),

  /* ---------------------------------------------------------------------- */
  /* Rate limiting                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Sliding-window counter.
   *
   * `scope` identifies what is limited (`login`, `submit-source`), `subject`
   * who is limited (an IP or a user id).
   */
  rateLimit: (scope: string, subject: string): string =>
    namespacedKey(['ratelimit', segment(scope), segment(subject)]),

  /** Failed-login counter, separate so it survives a rate-limit reset. */
  loginAttempts: (identifier: string): string =>
    namespacedKey(['login-attempts', segment(identifier)]),

  /* ---------------------------------------------------------------------- */
  /* Catalogue cache                                                         */
  /* ---------------------------------------------------------------------- */

  /** A rendered anime detail response. */
  anime: (slug: string): string => namespacedKey(['anime', segment(slug)]),

  /** A catalogue listing page, keyed by a hash of its filters. */
  animeList: (filterHash: string): string => namespacedKey(['anime-list', segment(filterHash)]),

  /** Concurrent viewers of a title, for the "watching now" badge. */
  animeViewers: (animeId: string): string => namespacedKey(['anime', segment(animeId), 'viewers']),

  /* ---------------------------------------------------------------------- */
  /* Presence and realtime                                                   */
  /* ---------------------------------------------------------------------- */

  userPresence: (userId: string): string => namespacedKey(['user', segment(userId), 'presence']),

  /** Authoritative watch-party playback state. */
  watchPartyState: (partyId: string): string =>
    namespacedKey(['watch-party', segment(partyId), 'state']),

  /** Set of user ids currently in a room. */
  watchPartyMembers: (partyId: string): string =>
    namespacedKey(['watch-party', segment(partyId), 'members']),

  /** Pub/sub channel fanning events to other API instances. */
  watchPartyChannel: (partyId: string): string =>
    namespacedKey(['watch-party', segment(partyId), 'events']),

  /** Global pub/sub channel for presence changes. */
  presenceChannel: (): string => namespacedKey(['presence', 'events']),

  /* ---------------------------------------------------------------------- */
  /* Locks                                                                   */
  /* ---------------------------------------------------------------------- */

  lock: (name: string): string => namespacedKey(['lock', segment(name)]),

  /* ---------------------------------------------------------------------- */
  /* Idempotency                                                             */
  /* ---------------------------------------------------------------------- */

  /** Guards double submission of a mutating request. */
  idempotency: (key: string): string => namespacedKey(['idempotency', segment(key)]),
} as const;

/** Standard TTLs, in seconds. Named so call sites do not carry magic numbers. */
export const redisTtl = {
  session: 60 * 15,
  csrf: 60 * 60 * 2,
  animeDetail: 60 * 5,
  animeList: 60 * 2,
  presence: 60,
  viewers: 30,
  watchPartyState: 60 * 60 * 6,
  lock: 30,
  idempotency: 60 * 60 * 24,
} as const;
