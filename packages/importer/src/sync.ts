import { eq, sql, inArray } from 'drizzle-orm';
import {
  createDatabase,
  entries,
  entryGenres,
  entryOrganizations,
  entryTags,
  genres,
  mediaAssets,
  organizations,
  series,
  tags,
  type Database,
} from '@playanime/database';
import { slugify } from '@playanime/shared';
import { fetchAniListPage } from './anilist-client.js';
import { fetchJikanAnime } from './jikan-client.js';
import { translateToPolish } from './deepl-client.js';
import { fetchImageMeta } from './image-meta.js';
import { mapAniListMedia } from './map-fields.js';
import { resolveOrCreateTaxonomy, type TaxonomyTable } from './taxonomy.js';
import type { AniListMedia, MappedAnime } from './types.js';

export interface SyncOptions {
  readonly season?: string | undefined;
  readonly seasonYear?: number | undefined;
  /** Bounds total titles processed across all pages — for a test run. */
  readonly limit?: number | undefined;
  /** Logs what would be written without touching the database. */
  readonly dryRun: boolean;
  /** Cross-references Jikan for a synopsis/studio gap. Off by default — extra requests, extra latency. */
  readonly useJikan: boolean;
  readonly deeplApiKey?: string | undefined;
  /**
   * Progress/diagnostic messages — a plain callback rather than this
   * module calling `console.*` itself, since this is a library file (not
   * a `scripts/`/`seeds/`/`bin/` path this repo's eslint config exempts
   * from `no-console`) and a caller embedding this package elsewhere
   * shouldn't have output forced on it. `cli.ts` passes
   * `console.log`/`console.warn` directly.
   */
  readonly onLog?: ((message: string) => void) | undefined;
}

interface SyncStats {
  fetched: number;
  imported: number;
  updated: number;
  skipped: number;
  genresTranslated: number;
  tagsTranslated: number;
}

/**
 * Ensures every name in `names` has a row in `table` (matched by `name`,
 * NOT by slugify(name) — this app's dev seed hand-picks a Polish slug for
 * every genre, e.g. `akcja` for English name "Action", so a slug-based
 * match would never recognize that row as the same genre and would
 * create a duplicate English-slugged "action" row on every real run;
 * caught during manual verification of a real import against the seeded
 * dev database, not by any type check), then translates and backfills
 * `namePolish` for any row that still lacks one — translated once, never
 * re-translated on a later run (a `namePolish` already set, including a
 * hand-edited one, is never overwritten). Shared between genres and tags
 * since both tables have the identical slug/name/namePolish shape. A row
 * genuinely new to this table (nothing existing has this name) gets an
 * English-derived slug, since there's no Polish slug to prefer for a
 * genre/tag this app has never seen before.
 */
async function ensureNamesWithPolish(
  db: Database,
  table: TaxonomyTable,
  names: readonly string[],
  extra: (name: string) => Record<string, unknown>,
  deeplApiKey: string | undefined,
  dryRun: boolean,
  onLog: (message: string) => void,
): Promise<number> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return 0;

  if (!dryRun) {
    await resolveOrCreateTaxonomy(db, table, unique, extra);
  }

  if (deeplApiKey === undefined) return 0;

  const untranslated = await db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(sql`${table.namePolish} is null`);

  if (untranslated.length === 0) return 0;

  const translated = await translateToPolish(
    deeplApiKey,
    untranslated.map((row) => row.name),
  );

  if (dryRun) {
    onLog(`  [dry-run] would translate ${String(untranslated.length)} names`);
    return untranslated.length;
  }

  for (let i = 0; i < untranslated.length; i += 1) {
    const row = untranslated[i];
    const polish = translated[i];
    if (row === undefined || polish === undefined) continue;
    await db.update(table).set({ namePolish: polish }).where(eq(table.id, row.id));
  }

  return untranslated.length;
}

/** Studios: `organizations`, keyed by slugified name — same pattern as the dev seed. */
async function ensureStudios(db: Database, names: readonly string[], dryRun: boolean): Promise<void> {
  const unique = [...new Set(names)];
  if (unique.length === 0 || dryRun) return;

  await db
    .insert(organizations)
    .values(unique.map((name) => ({ slug: slugify(name), name })))
    .onConflictDoNothing();
}

/** Replaces one entry's genre/tag/studio join rows inside a transaction. */
async function replaceRelations(db: Database, entryId: string, mapped: MappedAnime): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(entryGenres).where(eq(entryGenres.entryId, entryId));
    await tx.delete(entryTags).where(eq(entryTags.entryId, entryId));
    await tx.delete(entryOrganizations).where(eq(entryOrganizations.entryId, entryId));

    if (mapped.genreNames.length > 0) {
      const rows = await tx
        .select({ id: genres.id, name: genres.name })
        .from(genres)
        .where(inArray(genres.name, [...mapped.genreNames]));
      if (rows.length > 0) {
        await tx.insert(entryGenres).values(rows.map((row) => ({ entryId, genreId: row.id })));
      }
    }

    if (mapped.tags.length > 0) {
      const tagNames = mapped.tags.map((t) => t.name);
      const rows = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.name, tagNames));
      const byName = new Map(rows.map((row) => [row.name, row.id]));
      const values = mapped.tags.flatMap((t) => {
        const tagId = byName.get(t.name);
        return tagId === undefined ? [] : [{ entryId, tagId, rank: t.rank }];
      });
      if (values.length > 0) await tx.insert(entryTags).values(values);
    }

    if (mapped.studioNames.length > 0) {
      const slugs = mapped.studioNames.map((name) => slugify(name));
      const rows = await tx
        .select({ id: organizations.id, slug: organizations.slug })
        .from(organizations)
        .where(inArray(organizations.slug, slugs));
      if (rows.length > 0) {
        await tx.insert(entryOrganizations).values(
          rows.map((row, index) => ({
            entryId,
            organizationId: row.id,
            role: 'studio' as const,
            isPrimary: index === 0,
          })),
        );
      }
    }
  });
}

/**
 * Upserts one primary image asset (poster or banner) for an entry, matching
 * the dev seed's own media_assets shape.
 *
 * Also downloads the image to compute real width/height and a blurhash
 * placeholder — AniList's API gives none of these, only a bare CDN URL, so
 * without this every card would flash blank while artwork loads and every
 * `ImageRef` would carry `blurhash: null, width: null, height: null`
 * forever. The image bytes themselves are never stored anywhere; `url`
 * keeps pointing at the source CDN exactly as before, only the three
 * derived columns are new. A fetch/decode failure (dead link, non-image
 * response, corrupt file) is not worth failing the whole sync over — the
 * asset is still written with its URL and metadata left `null`, same as
 * this app's behavior before image metadata existed at all.
 */
async function ensureImageAsset(
  db: Database,
  entryId: string,
  kind: 'poster' | 'banner',
  url: string | null,
  onLog: (message: string) => void,
): Promise<void> {
  if (url === null) return;

  const [existing] = await db
    .select({ id: mediaAssets.id, url: mediaAssets.url })
    .from(mediaAssets)
    .where(sql`${mediaAssets.entryId} = ${entryId} and ${mediaAssets.kind} = ${kind} and ${mediaAssets.isPrimary} = true`)
    .limit(1);

  // Metadata is only ever worth recomputing when the URL actually changed —
  // AniList serves stable per-title CDN URLs, so re-downloading and
  // re-hashing an unchanged image on every sync run would be pure waste.
  if (existing?.url === url) return;

  const meta = await fetchImageMeta(url);
  if (meta === null) onLog(`  Could not fetch/decode image metadata for ${url}`);

  const values = {
    url,
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    blurhash: meta?.blurhash ?? null,
  };

  if (existing !== undefined) {
    await db.update(mediaAssets).set(values).where(eq(mediaAssets.id, existing.id));
    return;
  }

  await db.insert(mediaAssets).values({ entryId, kind, isPrimary: true, ...values });
}

/**
 * Imports or updates one mapped title. Returns whether it was newly created.
 *
 * Creates a Series + one main Entry per AniList media — matching the dev
 * seed's own one-Entry-per-legacy-title shape (Phase 1's greenfield
 * migration does the same). This bulk CLI does not attempt to split one
 * AniList title into multiple entries (seasons/cours/OVAs) or link
 * relations between titles — that is Phase 2's AniList `relations`-driven
 * sync, not this flat per-page import.
 */
async function upsertAnime(
  db: Database,
  mapped: MappedAnime,
  dryRun: boolean,
  onLog: (message: string) => void,
): Promise<'created' | 'updated'> {
  const [existing] = await db
    .select({ id: entries.id, seriesId: entries.seriesId })
    .from(entries)
    .where(eq(entries.anilistId, mapped.anilistId))
    .limit(1);

  if (dryRun) {
    onLog(`  [dry-run] would ${existing === undefined ? 'create' : 'update'}: ${mapped.titleRomaji}`);
    return existing === undefined ? 'created' : 'updated';
  }

  if (existing !== undefined) {
    await db
      .update(entries)
      .set({
        malId: mapped.malId,
        titleEnglish: mapped.titleEnglish,
        titleNative: mapped.titleNative,
        synopsis: mapped.synopsis,
        status: mapped.status as never,
        episodeCount: mapped.episodeCount,
        isAdult: mapped.isAdult,
      })
      .where(eq(entries.id, existing.id));
    // anilistScore, never averageRating — the latter is PlayAnime's own
    // real user-rating aggregate (recomputed only by
    // EngagementRepository.refreshRatingAggregate from real `ratings`
    // rows). This used to write AniList's score into `averageRating`
    // directly, which meant a re-sync silently destroyed any real user
    // ratings already aggregated there, and vice versa on the next rating
    // submission. See `series.anilistScore`'s own schema doc comment.
    await db
      .update(series)
      .set({ anilistScore: mapped.averageRating, popularityScore: mapped.popularityScore })
      .where(eq(series.id, existing.seriesId));

    await replaceRelations(db, existing.id, mapped);
    await ensureImageAsset(db, existing.id, 'poster', mapped.posterUrl, onLog);
    await ensureImageAsset(db, existing.id, 'banner', mapped.bannerUrl, onLog);
    return 'updated';
  }

  const base = slugify(mapped.titleRomaji);
  let slug = base;
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const [taken] = await db.select({ id: series.id }).from(series).where(eq(series.slug, slug)).limit(1);
    if (taken === undefined) break;
    slug = `${base.slice(0, 92)}-${String(suffix)}`;
  }

  const [seriesRow] = await db
    .insert(series)
    .values({
      slug,
      title: mapped.titleRomaji,
      synopsis: mapped.synopsis,
      // anilistScore, not averageRating — see the update branch above for why.
      // A newly-created series has no ratings of its own yet, so averageRating
      // is correctly left at its column default (null) here.
      anilistScore: mapped.averageRating,
      popularityScore: mapped.popularityScore,
    })
    .returning({ id: series.id });

  if (seriesRow === undefined) throw new Error('Series insert returned no row.');

  const [row] = await db
    .insert(entries)
    .values({
      seriesId: seriesRow.id,
      slug: 'main',
      anilistId: mapped.anilistId,
      malId: mapped.malId,
      entryType: mapped.format as never,
      titleRomaji: mapped.titleRomaji,
      titleEnglish: mapped.titleEnglish,
      titleNative: mapped.titleNative,
      synopsis: mapped.synopsis,
      status: mapped.status as never,
      airingSeason: mapped.season as never,
      airingYear: mapped.seasonYear,
      startDate: mapped.startDate,
      endDate: mapped.endDate,
      episodeCount: mapped.episodeCount,
      durationMinutes: mapped.durationMinutes,
      isAdult: mapped.isAdult,
    })
    // entries_anilist_id_key is a PARTIAL unique index (`where anilist_id
    // is not null`), and Postgres can only match an ON CONFLICT target
    // against a partial index if the predicate is repeated here exactly;
    // omitting it fails at the database with "no unique or exclusion
    // constraint matching the ON CONFLICT specification" — caught by
    // actually running this against the live dev database, not by
    // typechecking.
    .onConflictDoNothing({ target: entries.anilistId, where: sql`${entries.anilistId} is not null` })
    .returning({ id: entries.id });

  if (row === undefined) {
    // A concurrent run (or a race with the pre-check above) already
    // created it — treat as an update rather than erroring. The just-created
    // series row is left in place: a second, unlinked series is a smaller
    // problem than losing the race entirely, and re-running the sync is
    // idempotent from here since the entry lookup above will now find it.
    return upsertAnime(db, mapped, dryRun, onLog);
  }

  await replaceRelations(db, row.id, mapped);
  await ensureImageAsset(db, row.id, 'poster', mapped.posterUrl, onLog);
  await ensureImageAsset(db, row.id, 'banner', mapped.bannerUrl, onLog);

  return 'created';
}

async function enrichFromJikan(mapped: MappedAnime, useJikan: boolean): Promise<MappedAnime> {
  if (!useJikan || mapped.malId === null) return mapped;
  if (mapped.synopsis !== null && mapped.synopsis.length > 0) return mapped;

  const jikan = await fetchJikanAnime(mapped.malId);
  if (jikan === null) return mapped;

  return {
    ...mapped,
    synopsis: mapped.synopsis ?? jikan.synopsis,
    studioNames: mapped.studioNames.length > 0 ? mapped.studioNames : jikan.studios.map((s) => s.name),
  };
}

export async function runSync(options: SyncOptions): Promise<SyncStats> {
  const { db, sql: connection } = createDatabase({ maxConnections: 1 });
  const stats: SyncStats = { fetched: 0, imported: 0, updated: 0, skipped: 0, genresTranslated: 0, tagsTranslated: 0 };

  const onLog = options.onLog ?? (() => undefined);

  try {
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage && (options.limit === undefined || stats.fetched < options.limit)) {
      onLog(`Fetching AniList page ${String(page)}...`);
      const result = await fetchAniListPage({
        page,
        perPage: 50,
        season: options.season,
        seasonYear: options.seasonYear,
      });
      hasNextPage = result.hasNextPage;
      page += 1;

      const batch: AniListMedia[] =
        options.limit === undefined ? [...result.media] : result.media.slice(0, options.limit - stats.fetched);

      const mappedBatch: MappedAnime[] = [];
      for (const media of batch) {
        const mapped = mapAniListMedia(media);
        if (mapped === null) {
          onLog(`  Skipping AniList id ${String(media.id)} — missing format/title.`);
          stats.skipped += 1;
          continue;
        }
        mappedBatch.push(await enrichFromJikan(mapped, options.useJikan));
      }

      stats.fetched += mappedBatch.length;

      const genresTranslated = await ensureNamesWithPolish(
        db,
        genres,
        mappedBatch.flatMap((m) => m.genreNames),
        () => ({}),
        options.deeplApiKey,
        options.dryRun,
        onLog,
      );
      stats.genresTranslated += genresTranslated;

      const tagsByName = new Map(mappedBatch.flatMap((m) => m.tags).map((t) => [t.name, t]));
      const tagsTranslated = await ensureNamesWithPolish(
        db,
        tags,
        [...tagsByName.keys()],
        (name) => {
          const tag = tagsByName.get(name);
          return { category: tag?.category ?? null, isAdult: tag?.isAdult ?? false };
        },
        options.deeplApiKey,
        options.dryRun,
        onLog,
      );
      stats.tagsTranslated += tagsTranslated;

      for (const mapped of mappedBatch) {
        await ensureStudios(db, mapped.studioNames, options.dryRun);
        const outcome = await upsertAnime(db, mapped, options.dryRun, onLog);
        if (outcome === 'created') stats.imported += 1;
        else stats.updated += 1;
      }
    }

    return stats;
  } finally {
    await connection.end({ timeout: 5 });
  }
}
