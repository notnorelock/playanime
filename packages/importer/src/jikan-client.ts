import type { JikanAnimeFull } from './types.js';

/**
 * Jikan is used only as a secondary cross-reference, keyed by the `idMal`
 * AniList already returns — never as primary discovery. Its documented
 * limit is 3 req/s / 60 req/min; unlike AniList it returns a plain 429
 * with no useful Retry-After guidance in most deployments, so the
 * importer throttles itself proactively rather than reacting to a 429.
 */
const MIN_INTERVAL_MS = 350; // ~2.85 req/s, comfortably under Jikan's 3 req/s limit

let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

interface RawJikanResponse {
  readonly data?: {
    readonly synopsis: string | null;
    readonly studios: readonly { readonly name: string }[];
  };
}

/**
 * Fetches supplementary fields for one MAL id. Returns null on any
 * failure (not found, rate-limited after a retry, network error) — Jikan
 * is a gap-filler, never required for a title to import successfully.
 */
export async function fetchJikanAnime(malId: number): Promise<JikanAnimeFull | null> {
  await throttle();

  const response = await fetch(`https://api.jikan.moe/v4/anime/${String(malId)}/full`);

  if (response.status === 429) {
    // One retry after a longer pause — Jikan's limit can be tripped by
    // other traffic against the same public endpoint, not just this
    // process's own request rate.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await throttle();
    const retry = await fetch(`https://api.jikan.moe/v4/anime/${String(malId)}/full`);
    if (!retry.ok) return null;
    const body = (await retry.json()) as RawJikanResponse;
    return body.data === undefined ? null : { synopsis: body.data.synopsis, studios: body.data.studios };
  }

  if (!response.ok) return null;

  const body = (await response.json()) as RawJikanResponse;
  return body.data === undefined ? null : { synopsis: body.data.synopsis, studios: body.data.studios };
}
