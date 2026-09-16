import type { RedisClient } from './client.js';
import { redis } from './client.js';
import { redisKeys } from './keys.js';

/**
 * Sliding-window rate limiting.
 *
 * Implemented as a sorted set of request timestamps rather than a fixed-window
 * counter. A fixed window lets a caller send 2x the limit across a window
 * boundary — 100 requests at 11:59:59 and 100 more at 12:00:00 — which is
 * exactly the burst a login limiter must prevent.
 *
 * The whole operation is a Lua script so the read, trim, count and write happen
 * atomically. Doing it in round trips lets concurrent requests each observe a
 * count below the limit and all pass.
 */

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

-- Drop entries that have aged out of the window.
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

local count = redis.call('ZCARD', key)

if count >= limit then
  -- Report when the oldest entry expires, so the caller can send Retry-After.
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfter = window
  if oldest[2] ~= nil then
    retryAfter = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
  end
  return { 0, count, retryAfter }
end

redis.call('ZADD', key, now, member)
-- Expire the key itself so an idle subject leaves nothing behind.
redis.call('PEXPIRE', key, window)

return { 1, count + 1, 0 }
`;

export interface RateLimitRule {
  /** What is being limited, e.g. `login`. Forms part of the key. */
  readonly scope: string;
  /** Maximum requests permitted within the window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the caller may retry. Zero when allowed. */
  readonly retryAfterSeconds: number;
}

/**
 * Platform rate limits.
 *
 * Centralized so limits are reviewable in one place rather than scattered
 * across route definitions.
 */
export const RATE_LIMITS = {
  /** Deliberately strict: this is the brute-force surface. */
  login: { scope: 'login', limit: 5, windowMs: 60_000 },
  register: { scope: 'register', limit: 3, windowMs: 60 * 60_000 },
  passwordReset: { scope: 'password-reset', limit: 3, windowMs: 60 * 60_000 },

  /** Submissions enter a moderation queue, so the limit protects moderators. */
  submitSource: { scope: 'submit-source', limit: 10, windowMs: 60 * 60_000 },
  submitReport: { scope: 'submit-report', limit: 20, windowMs: 60 * 60_000 },
  comment: { scope: 'comment', limit: 20, windowMs: 60_000 },

  /**
   * Creating a group claims a public name and slug permanently, so the limit is
   * tighter than for content a moderator can simply remove.
   */
  createTranslatorGroup: { scope: 'create-translator-group', limit: 3, windowMs: 24 * 60 * 60_000 },

  /**
   * Creating a title claims a permanent slug and is visible to everyone, so the
   * limit is tighter than for a source a moderator can simply disable.
   */
  createAnime: { scope: 'create-anime', limit: 20, windowMs: 60 * 60_000 },

  /** Generous default for ordinary reads. */
  api: { scope: 'api', limit: 300, windowMs: 60_000 },
  search: { scope: 'search', limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Consumes one unit of a subject's allowance.
 *
 * `subject` should be a user id where one is known, and the resolved client IP
 * otherwise. Passing a raw `X-Forwarded-For` value here would let a caller
 * bypass the limit by varying the header — the API resolves the trusted client
 * IP before calling this.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  subject: string,
  client: RedisClient = redis(),
): Promise<RateLimitResult> {
  const key = redisKeys.rateLimit(rule.scope, subject);
  const now = Date.now();
  // Unique member per request; two requests in the same millisecond must both
  // count, which a bare timestamp would not guarantee.
  const member = `${String(now)}-${Math.random().toString(36).slice(2, 10)}`;

  const raw = (await client.eval(
    SLIDING_WINDOW_SCRIPT,
    1,
    key,
    String(now),
    String(rule.windowMs),
    String(rule.limit),
    member,
  )) as [number, number, number];

  const [allowed, count, retryAfter] = raw;

  return {
    allowed: allowed === 1,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: retryAfter,
  };
}

/** Clears a subject's allowance. Used after a successful login. */
export async function resetRateLimit(
  rule: RateLimitRule,
  subject: string,
  client: RedisClient = redis(),
): Promise<void> {
  await client.del(redisKeys.rateLimit(rule.scope, subject));
}
