import { MINUTE_MS, SECOND_MS } from '@playanime/shared';

/**
 * Cache TTL must always end before Google's signed URL dies.
 *
 * A longer remaining lifetime uses a larger safety margin so a cached
 * descriptor is not handed out minutes before expiry. A short remaining
 * lifetime uses a smaller margin so we still cache at all.
 */

export const UNKNOWN_EXPIRY_TTL_SECONDS = 5 * 60;
export const MINIMUM_CACHE_TTL_SECONDS = 30;
export const SHORT_SAFETY_MARGIN_MS = 5 * MINUTE_MS;
export const LONG_SAFETY_MARGIN_MS = 15 * MINUTE_MS;
export const LONG_LIFETIME_THRESHOLD_MS = 60 * MINUTE_MS;

export function parseExpireParam(url: string): Date | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  const raw = parsed.searchParams.get('expire') ?? parsed.searchParams.get('expires');
  if (raw === null) return undefined;

  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;

  // Drive uses unix seconds. Guard against millisecond values accidentally
  // copied from Date.now().
  const millis = seconds > 1_000_000_000_000 ? seconds : seconds * SECOND_MS;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function earliestExpiration(urls: readonly string[], fallback?: Date): Date | undefined {
  let earliest: Date | undefined;

  for (const url of urls) {
    const expiresAt = parseExpireParam(url);
    if (expiresAt === undefined) continue;
    if (earliest === undefined || expiresAt.getTime() < earliest.getTime()) {
      earliest = expiresAt;
    }
  }

  if (earliest !== undefined) return earliest;
  return fallback;
}

export function cacheTtlSeconds(expiresAt: Date, now: Date): number {
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 0) return 0;

  const margin = remaining > LONG_LIFETIME_THRESHOLD_MS ? LONG_SAFETY_MARGIN_MS : SHORT_SAFETY_MARGIN_MS;
  const ttlMs = remaining - margin;

  if (ttlMs < MINIMUM_CACHE_TTL_SECONDS * SECOND_MS) return 0;
  return Math.floor(ttlMs / SECOND_MS);
}

export function isExpired(expiresAt: Date, now: Date, skewMs = SECOND_MS): boolean {
  return expiresAt.getTime() <= now.getTime() + skewMs;
}
