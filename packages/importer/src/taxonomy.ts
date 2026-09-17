import { inArray } from 'drizzle-orm';
import type { genres, tags, Database } from '@playanime/database';
import { slugify } from '@playanime/shared';

/**
 * Resolves AniList genre/tag names against this app's own taxonomy
 * tables, matched by the `name` column — NOT by `slugify(name)`, since
 * this app's dev seed hand-picks a Polish slug for every genre (e.g.
 * `akcja` for English "Action"); a slug-based match would never
 * recognize that row as the same genre and would create a duplicate
 * English-slugged row on every sync. Confirmed the hard way: this was a
 * real bug in the original bulk importer, caught during manual
 * verification against the seeded dev database, not by any type check.
 *
 * `sync.ts`'s `ensureNamesWithPolish` (the bulk CLI's own genre/tag
 * upsert, which additionally handles DeepL translation and a dry-run
 * mode neither of these callers need) and `catalogue.service.ts`'s
 * `syncAnimeFromAniList` (an existing title's on-demand re-sync) both
 * need this exact same name-matching discipline — sharing it here as one
 * function each calls, rather than reimplementing the lookup twice,
 * is what keeps the two from drifting apart on this rule.
 */

export type TaxonomyTable = typeof genres | typeof tags;

export interface TaxonomyRow {
  readonly id: string;
  readonly slug: string;
}

/**
 * Looks up existing rows in `table` by name; any name with no match is
 * inserted (English-derived slug, since there's no Polish slug to prefer
 * for something this app has never seen before — `namePolish` is left
 * null, exactly like the bulk importer's own untranslated-row state).
 * Returns every row (pre-existing and newly created) keyed by the
 * requested names, so the caller can build its own name -> id/slug map
 * without a second query — both are returned since a join-table insert
 * needs the id and a caller reporting what changed usually wants the
 * slug.
 */
export async function resolveOrCreateTaxonomy(
  db: Database,
  table: TaxonomyTable,
  names: readonly string[],
  extra: (name: string) => Record<string, unknown> = () => ({}),
): Promise<Map<string, TaxonomyRow>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return new Map();

  const existingRows = await db
    .select({ id: table.id, name: table.name, slug: table.slug })
    .from(table)
    .where(inArray(table.name, unique));

  const byName = new Map(existingRows.map((row) => [row.name, { id: row.id, slug: row.slug }]));
  const toCreate = unique.filter((name) => !byName.has(name));

  if (toCreate.length > 0) {
    const created = await db
      .insert(table)
      .values(toCreate.map((name) => ({ slug: slugify(name), name, ...extra(name) })))
      .onConflictDoNothing()
      .returning({ id: table.id, name: table.name, slug: table.slug });

    for (const row of created) byName.set(row.name, { id: row.id, slug: row.slug });

    // onConflictDoNothing means a genuine race (a concurrent insert of the
    // same slug between the select above and this insert) returns no row
    // for that name — re-select rather than leave it unresolved.
    const stillMissing = toCreate.filter((name) => !byName.has(name));
    if (stillMissing.length > 0) {
      const rows = await db
        .select({ id: table.id, name: table.name, slug: table.slug })
        .from(table)
        .where(inArray(table.name, stillMissing));
      for (const row of rows) byName.set(row.name, { id: row.id, slug: row.slug });
    }
  }

  return byName;
}

/**
 * The lookup-only variant genres use everywhere outside the bulk
 * importer: resolves names that already exist, silently omitting any
 * that don't — never creates a row. Genres are a small, deliberately
 * curated list (unlike `tags`, which exists specifically to receive
 * AniList's much larger free-form set), so a genre AniList has that this
 * catalogue doesn't know about is left for a human to add, not
 * auto-created by a sync action.
 */
export async function resolveKnownTaxonomy(
  db: Database,
  table: TaxonomyTable,
  names: readonly string[],
): Promise<Map<string, TaxonomyRow>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: table.id, name: table.name, slug: table.slug })
    .from(table)
    .where(inArray(table.name, unique));
  return new Map(rows.map((row) => [row.name, { id: row.id, slug: row.slug }]));
}
