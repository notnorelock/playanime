import { db } from '../client/index.js';
import { genres } from '../schema/anime.js';
import { CORE_GENRES } from '../taxonomy/genres.js';

/**
 * Ensures the curated genre catalogue exists, idempotently.
 *
 * Deploys run migrations (schema) but never the dev seed script (which also
 * inserts demo anime/episodes — never something to run against a real
 * database). A deploy that only ever ran migrations left the `genres`
 * table created but empty: every genre lookup returned nothing, so new
 * titles got created with no genres attached and AniList autofill/re-sync
 * had nothing to match against, both silently — `applyGenres`/
 * `resolveKnownTaxonomy` treat "genre not in the table" the same as
 * "genre doesn't apply," with no error surfaced anywhere.
 *
 * `onConflictDoNothing` on the slug makes this safe to run on every
 * startup, in every environment — a fresh database gets seeded, an
 * already-seeded one is untouched. This is deliberately narrower than the
 * dev seed script: only the fixed genre list, nothing else.
 */
export async function ensureCoreTaxonomy(): Promise<void> {
  await db().insert(genres).values([...CORE_GENRES]).onConflictDoNothing();
}
