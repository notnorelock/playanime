import { eq, sql, inArray } from 'drizzle-orm';
import {
  anime,
  animeGenres,
  animeOrganizations,
  animeTags,
  createDatabase,
  genres,
  mediaAssets,
  organizations,
  seasons,
  tags,
  type Database,
} from '@playanime/database';
import { slugify } from '@playanime/shared';
import { fetchAniListPage } from './anilist-client.js';
import { fetchJikanAnime } from './jikan-client.js';
import { translateToPolish } from './deepl-client.js';
import { mapAniListMedia } from './map-fields.js';
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
 * Ensures every name in `names` has a row in `table` (by slug), then
 * translates and backfills `namePolish` for any row that still lacks
 * one — translated once, never re-translated on a later run (a
 * `namePolish` already set, including a hand-edited one, is never
 * overwritten). Shared between genres and tags since both tables have
 * the identical slug/name/namePolish shape.
 */
async function ensureNamesWithPolish(
  db: Database,
  table: typeof genres | typeof tags,
  names: readonly string[],
  extra: (name: string) => Record<string, unknown>,
  deeplApiKey: string | undefined,
  dryRun: boolean,
  onLog: (message: string) => void,
): Promise<number> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return 0;

  if (!dryRun) {
    await db
      .insert(table)
      .values(unique.map((name) => ({ slug: slugify(name), name, ...extra(name) })))
      .onConflictDoNothing();
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

/** Replaces one anime's genre/tag/studio join rows inside a transaction. */
async function replaceRelations(db: Database, animeId: string, mapped: MappedAnime): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(animeGenres).where(eq(animeGenres.animeId, animeId));
    await tx.delete(animeTags).where(eq(animeTags.animeId, animeId));
    await tx.delete(animeOrganizations).where(eq(animeOrganizations.animeId, animeId));

    if (mapped.genreNames.length > 0) {
      const rows = await tx
        .select({ id: genres.id, name: genres.name })
        .from(genres)
        .where(inArray(genres.name, [...mapped.genreNames]));
      if (rows.length > 0) {
        await tx.insert(animeGenres).values(rows.map((row) => ({ animeId, genreId: row.id })));
      }
    }

    if (mapped.tags.length > 0) {
      const tagNames = mapped.tags.map((t) => t.name);
      const rows = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.name, tagNames));
      const byName = new Map(rows.map((row) => [row.name, row.id]));
      const values = mapped.tags.flatMap((t) => {
        const tagId = byName.get(t.name);
        return tagId === undefined ? [] : [{ animeId, tagId, rank: t.rank }];
      });
      if (values.length > 0) await tx.insert(animeTags).values(values);
    }

    if (mapped.studioNames.length > 0) {
      const slugs = mapped.studioNames.map((name) => slugify(name));
      const rows = await tx
        .select({ id: organizations.id, slug: organizations.slug })
        .from(organizations)
        .where(inArray(organizations.slug, slugs));
      if (rows.length > 0) {
        await tx.insert(animeOrganizations).values(
          rows.map((row, index) => ({
            animeId,
            organizationId: row.id,
            role: 'studio' as const,
            isPrimary: index === 0,
          })),
        );
      }
    }
  });
}

/** Upserts the poster asset, matching the dev seed's own media_assets shape. */
async function ensurePoster(db: Database, animeId: string, posterUrl: string | null): Promise<void> {
  if (posterUrl === null) return;

  const [existing] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(sql`${mediaAssets.animeId} = ${animeId} and ${mediaAssets.kind} = 'poster' and ${mediaAssets.isPrimary} = true`)
    .limit(1);

  if (existing !== undefined) {
    await db.update(mediaAssets).set({ url: posterUrl }).where(eq(mediaAssets.id, existing.id));
    return;
  }

  await db.insert(mediaAssets).values({ animeId, kind: 'poster', url: posterUrl, isPrimary: true });
}

/** Imports or updates one mapped title. Returns whether it was newly created. */
async function upsertAnime(
  db: Database,
  mapped: MappedAnime,
  dryRun: boolean,
  onLog: (message: string) => void,
): Promise<'created' | 'updated'> {
  const [existing] = await db
    .select({ id: anime.id })
    .from(anime)
    .where(eq(anime.anilistId, mapped.anilistId))
    .limit(1);

  if (dryRun) {
    onLog(`  [dry-run] would ${existing === undefined ? 'create' : 'update'}: ${mapped.titleRomaji}`);
    return existing === undefined ? 'created' : 'updated';
  }

  if (existing !== undefined) {
    await db
      .update(anime)
      .set({
        malId: mapped.malId,
        titleEnglish: mapped.titleEnglish,
        titleNative: mapped.titleNative,
        synopsis: mapped.synopsis,
        status: mapped.status as never,
        episodeCount: mapped.episodeCount,
        isAdult: mapped.isAdult,
        averageRating: mapped.averageRating,
        popularityScore: mapped.popularityScore,
      })
      .where(eq(anime.id, existing.id));

    await replaceRelations(db, existing.id, mapped);
    await ensurePoster(db, existing.id, mapped.posterUrl);
    return 'updated';
  }

  const base = slugify(mapped.titleRomaji);
  let slug = base;
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const [taken] = await db.select({ id: anime.id }).from(anime).where(eq(anime.slug, slug)).limit(1);
    if (taken === undefined) break;
    slug = `${base.slice(0, 92)}-${String(suffix)}`;
  }

  const [row] = await db
    .insert(anime)
    .values({
      slug,
      anilistId: mapped.anilistId,
      malId: mapped.malId,
      titleRomaji: mapped.titleRomaji,
      titleEnglish: mapped.titleEnglish,
      titleNative: mapped.titleNative,
      synopsis: mapped.synopsis,
      format: mapped.format as never,
      status: mapped.status as never,
      season: mapped.season as never,
      seasonYear: mapped.seasonYear,
      startDate: mapped.startDate,
      endDate: mapped.endDate,
      episodeCount: mapped.episodeCount,
      durationMinutes: mapped.durationMinutes,
      isAdult: mapped.isAdult,
      averageRating: mapped.averageRating,
      popularityScore: mapped.popularityScore,
    })
    // anime_anilist_id_key is a PARTIAL unique index (`where anilist_id is
    // not null` — see the schema migration), and Postgres can only match
    // an ON CONFLICT target against a partial index if the predicate is
    // repeated here exactly; omitting it fails at the database with "no
    // unique or exclusion constraint matching the ON CONFLICT
    // specification" — caught by actually running this against the live
    // dev database, not by typechecking.
    .onConflictDoNothing({ target: anime.anilistId, where: sql`${anime.anilistId} is not null` })
    .returning({ id: anime.id });

  if (row === undefined) {
    // A concurrent run (or a race with the pre-check above) already
    // created it — treat as an update rather than erroring.
    return upsertAnime(db, mapped, dryRun, onLog);
  }

  await replaceRelations(db, row.id, mapped);
  await ensurePoster(db, row.id, mapped.posterUrl);

  // A single unseasoned "season 1" row, matching the dev seed's own
  // placeholder shape — episode-level detail is a separate concern this
  // importer doesn't attempt (AniList doesn't reliably expose per-episode
  // titles/air dates in the same query).
  await db.insert(seasons).values({ animeId: row.id, number: 1 }).onConflictDoNothing();

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
