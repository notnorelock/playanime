import type {
  AnimeAutofillResponse,
  AnimeSearchResponse,
  AnimeSyncResponse,
  CatalogueAuditTrail,
  CatalogueProposalDecisionBody,
  CatalogueProposalQueue,
  EntryByAnilistResponse,
  EntryCreateBody,
  EntryEditBody,
  EpisodeBulkCreateBody,
  EpisodeCreateBody,
  EpisodeEditBody,
  MediaAssetUpsertBody,
  ProposeAnimeEditResponse,
  SeriesCreateBody,
} from '@playanime/contracts';
import {
  AnimeRepository,
  CatalogueRepository,
  TranslatorRepository,
  blockedTitles,
  db,
  genres,
  tags,
} from '@playanime/database';
import { isNull, eq, or } from 'drizzle-orm';
import { env } from '@playanime/config';
import type { AniListMedia, ImageMeta, MappedAnime, TaxonomyTable } from '@playanime/importer';
import {
  fetchAniListById,
  fetchImageMeta,
  mapAniListMedia,
  mapAverageRating,
  mapFormat,
  mapSeason,
  mapStatus,
  resolveOrCreateTaxonomy,
  searchAniList,
  translateToPolish,
} from '@playanime/importer';
import {
  AppError,
  AuthorizationError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  ValidationError,
  slugify,
} from '@playanime/shared';
import { logger } from '../../plugins/error-handler.js';
import { invalidateAnimeCaches } from './cache.js';
import type { AuthoringContext } from './permissions.js';

/**
 * Catalogue authoring.
 *
 * The rule running through this module: a title is global and its slug is
 * permanent, so creation is guarded harder than editing, and nothing here ever
 * hard-deletes. Ratings, library entries and watch progress all point at these
 * rows, and removing one would silently destroy a viewer's history.
 */

const repository = new CatalogueRepository(db());
const translatorRepository = new TranslatorRepository(db());
const animeRepository = new AnimeRepository(db());

/** How many numbered suffixes to try before giving up on a slug. */
const MAX_SLUG_ATTEMPTS = 50;

/**
 * Resolves real width/height and a blurhash placeholder for a poster/banner
 * pair, in parallel, before any repository write starts — the actual image
 * download+decode must finish here, outside any database transaction, since
 * `CatalogueRepository`'s writers hold theirs open only for DB statements
 * (see `ImageAssetMeta`'s doc comment in catalogue.repository.ts). A `null`
 * URL or a failed fetch/decode both resolve to `null` metadata, which every
 * repository write already treats as "no metadata available" — the same
 * outcome as before this existed, just for a mapped reason instead of an
 * always-null column.
 */
async function resolveArtworkMeta(
  posterUrl: string | null,
  bannerUrl: string | null,
): Promise<{ poster: ImageMeta | null; banner: ImageMeta | null }> {
  const [poster, banner] = await Promise.all([
    posterUrl === null ? Promise.resolve(null) : fetchImageMeta(posterUrl),
    bannerUrl === null ? Promise.resolve(null) : fetchImageMeta(bannerUrl),
  ]);
  return { poster, banner };
}

/**
 * Derives a unique slug from the canonical title.
 *
 * Never client-supplied: a slug is permanent and appears in every link, so
 * letting a caller choose one invites squatting on the slugs of popular titles.
 */
async function deriveSlug(title: string): Promise<string> {
  const base = slugify(title);

  if (base.length === 0) {
    throw new ValidationError('Tytuł musi zawierać litery lub cyfry.', [
      { path: 'titleRomaji', message: 'Nieprawidłowy tytuł.' },
    ]);
  }

  if (!(await repository.seriesSlugTaken(base))) return base;

  for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS; suffix += 1) {
    const candidate = `${base.slice(0, 92)}-${String(suffix)}`;
    if (!(await repository.seriesSlugTaken(candidate))) return candidate;
  }

  throw new ConflictError('Nie udało się utworzyć unikalnego adresu dla tego tytułu.');
}

/**
 * Derives a unique slug for a new entry within a series — mirrors
 * `deriveSlug`, but scoped to one series' own entries rather than the
 * global series slug space, since an entry slug only needs to be unique
 * against its own series' other seasons/movies/OVAs.
 */
async function deriveEntrySlug(seriesId: string, title: string): Promise<string> {
  const base = slugify(title);

  if (base.length === 0) {
    throw new ValidationError('Tytuł musi zawierać litery lub cyfry.', [
      { path: 'titleRomaji', message: 'Nieprawidłowy tytuł.' },
    ]);
  }

  if (!(await repository.entrySlugTaken(seriesId, base))) return base;

  for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS; suffix += 1) {
    const candidate = `${base.slice(0, 92)}-${String(suffix)}`;
    if (!(await repository.entrySlugTaken(seriesId, candidate))) return candidate;
  }

  throw new ConflictError('Nie udało się utworzyć unikalnego adresu dla tego wydania.');
}

/**
 * Refuses an AniList/MAL id that was blocked by an approved takedown.
 *
 * Checked wherever a title could newly acquire that identity — creation and
 * AniList sync — so a taken-down title cannot simply be re-imported under a
 * new slug. Not a `NotFoundError`: unlike `requireEditableAnime`'s
 * deliberate 404 for an unauthorized editor, there is nothing to hide here —
 * the caller already knows the AniList id, and a clear "this was taken down"
 * response is more useful than a generic failure.
 */
async function requireTitleNotBlocked(anilistId: number | null, malId: number | null): Promise<void> {
  if (anilistId === null && malId === null) return;

  const conditions = [];
  if (anilistId !== null) conditions.push(eq(blockedTitles.anilistId, anilistId));
  if (malId !== null) conditions.push(eq(blockedTitles.malId, malId));

  const [blocked] = await db()
    .select({ id: blockedTitles.id, reason: blockedTitles.reason })
    .from(blockedTitles)
    .where(or(...conditions))
    .limit(1);

  if (blocked !== undefined) {
    throw new ConflictError('Ten tytuł został usunięty z katalogu i nie może zostać dodany ponownie.', {
      code: ErrorCode.TITLE_BLOCKED,
    });
  }
}

/**
 * Titles that resemble a proposed one.
 *
 * Advisory: the create endpoint does not refuse on a match. Two distinct works
 * legitimately share a title — a remake, a sequel named identically — and
 * blocking would make those entries impossible. The author is shown the matches
 * and decides.
 */
export async function checkDuplicates(title: string) {
  const rows = await repository.findSimilarTitles(title);

  return {
    matches: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      format: row.format as
        | 'tv'
        | 'tv_short'
        | 'movie'
        | 'ova'
        | 'ona'
        | 'special'
        | 'recap'
        | 'compilation'
        | 'music'
        | 'web'
        | 'other'
        | null,
      seasonYear: row.season_year,
      similarity: row.similarity,
    })),
  };
}

/**
 * Live AniList title search, for the "add anime" form's autocomplete —
 * deliberately thin results (just enough for a picker card); the full
 * field set is only fetched once an author picks one, via
 * `autofillFromAniList` below. Any AniList request failure surfaces as a
 * 502 `DEPENDENCY_UNAVAILABLE`, matching this app's existing convention
 * for a failed third-party call (see `packages/auth/src/oauth/discord.ts`),
 * rather than a generic 500.
 */
export async function searchAniListTitles(title: string): Promise<AnimeSearchResponse> {
  let media;
  try {
    media = await searchAniList(title);
  } catch (cause: unknown) {
    throw new AppError('Nie udało się połączyć z AniList.', {
      status: 502,
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
      expose: true,
      cause,
    });
  }

  return {
    results: media.map((m) => ({
      anilistId: m.id,
      titleRomaji: m.title.romaji ?? m.title.english ?? m.title.native ?? '',
      titleEnglish: m.title.english,
      format: mapFormat(m.format),
      seasonYear: m.seasonYear,
      posterUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
    })),
  };
}

/** Throws the standard 502 for any failed AniList call — matches this app's existing convention for a failed third-party call (see `packages/auth/src/oauth/discord.ts`). */
function aniListUnavailable(cause?: unknown): AppError {
  return new AppError('Nie udało się połączyć z AniList.', {
    status: 502,
    code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    expose: true,
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Fetches and maps one AniList entry by id — the shared step both
 * `autofillFromAniList` (a read-only preview) and `syncAnimeFromAniList`
 * (a real write against an existing title) need: the same 404/502
 * handling, the same `mapAniListMedia`/`mapFormat` mapping. Kept as one
 * function so the two callers can never drift on what counts as "AniList
 * didn't have enough for this title."
 */
async function fetchAndMapAniList(anilistId: number): Promise<{ media: AniListMedia; mapped: MappedAnime; format: NonNullable<ReturnType<typeof mapFormat>> }> {
  let media: AniListMedia | null;
  try {
    media = await fetchAniListById(anilistId);
  } catch (cause: unknown) {
    throw aniListUnavailable(cause);
  }

  if (media === null) {
    throw new NotFoundError('Nie znaleziono tego tytułu w AniList.');
  }

  const mapped = mapAniListMedia(media);
  // mapAniListMedia only returns null when media.format didn't map — so
  // re-deriving format via the real typed mapFormat here (rather than
  // trusting MappedAnime.format, which is typed loosely as `string`, an
  // internal DB-insert-oriented shape, not a wire contract) is always
  // non-null whenever mapped itself is non-null.
  const format = mapped === null ? null : mapFormat(media.format);
  if (mapped === null || format === null) {
    throw aniListUnavailable();
  }

  return { media, mapped, format };
}

/**
 * `EntryCreateBody.tags`'s own cap (packages/contracts/src/catalogue/
 * index.ts) — a long-running or popular title routinely has 50-80+ AniList
 * tags, well past it. Mirrored here as a literal rather than imported: it
 * is a create-time input constraint, not something this read-only preview
 * should couple its own type to.
 */
const MAX_AUTOFILL_TAGS = 30;

/**
 * The full autofill payload for one AniList id, picked from a search
 * result. Genre names are passed through as AniList reports them — this
 * is a read-only preview so nothing is created yet regardless, and
 * `AnimeCreateBody.genres` now creates an unrecognized one on demand at
 * write time, the same as `tags` already does, so there is nothing to
 * "already know" here worth resolving against.
 *
 * `tags`, unlike `genres`, IS capped — at `MAX_AUTOFILL_TAGS`, matching
 * `EntryCreateBody.tags`'s own limit exactly. Sent uncapped for a while: a
 * real production failure (`POST /catalogue/anime` 422'd with
 * "firstEntry/tags: Expected array length to be less or equal to 30" for
 * Naruto, Hunter x Hunter, and any other title with many years of
 * accumulated AniList tags) showed this response was not actually usable
 * as-is by the sibling `createAnime` endpoint it exists to feed. Kept
 * highest AniList `rank` first (AniList's own 0-100 relevance/vote score,
 * not just a truncated prefix) so the tags dropped are the least relevant
 * ones, not an arbitrary cut; a null rank (AniList reports one for some
 * tags) sorts last, after every ranked tag.
 */
export async function autofillFromAniList(anilistId: number): Promise<AnimeAutofillResponse> {
  const { media, mapped, format } = await fetchAndMapAniList(anilistId);

  const topTags = [...mapped.tags]
    .sort((a, b) => (b.rank ?? -1) - (a.rank ?? -1))
    .slice(0, MAX_AUTOFILL_TAGS)
    .map((tag) => tag.name);

  return {
    titleRomaji: mapped.titleRomaji,
    titleEnglish: mapped.titleEnglish,
    titleNative: mapped.titleNative,
    synopsis: mapped.synopsis,
    format,
    status: mapStatus(media.status),
    season: mapSeason(media.season),
    seasonYear: mapped.seasonYear,
    startDate: mapped.startDate,
    endDate: mapped.endDate,
    episodeCount: mapped.episodeCount,
    durationMinutes: mapped.durationMinutes,
    isAdult: mapped.isAdult,
    genres: [...mapped.genreNames],
    studios: [...mapped.studioNames],
    tags: topTags,
    posterUrl: mapped.posterUrl,
    bannerUrl: mapped.bannerUrl,
    malId: mapped.malId,
  };
}

/**
 * Existing catalogue entry for an AniList id, or `null` if none exists yet.
 * A pure local lookup — no AniList network call, unlike `autofillFromAniList`
 * above — so an AniList-first creation flow (including a bulk importer) can
 * check "does this already exist" before deciding to create.
 */
export async function findAnimeByAnilistId(anilistId: number): Promise<EntryByAnilistResponse> {
  return repository.findEntryByAnilistId(anilistId);
}

/** Translates every untranslated row in one taxonomy table. See `translateUntranslatedTaxonomy` below. */
async function translateUntranslatedRows(table: TaxonomyTable, deeplApiKey: string): Promise<void> {
  const database = db();
  const untranslated = await database
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(isNull(table.namePolish));

  if (untranslated.length === 0) return;

  const translated = await translateToPolish(
    deeplApiKey,
    untranslated.map((row) => row.name),
  );

  for (let i = 0; i < untranslated.length; i += 1) {
    const row = untranslated[i];
    const polish = translated[i];
    if (row === undefined || polish === undefined) continue;
    await database.update(table).set({ namePolish: polish }).where(eq(table.id, row.id));
  }
}

/**
 * Translates any genre or tag with no Polish name yet, via DeepL.
 *
 * Both are create-on-demand now (a translator hand-typing a new genre
 * or tag in the authoring form via `applyGenres`/`applyTags`, or an
 * AniList sync), so both can leave a row with no Polish name behind.
 *
 * Two call sites: every write that can create a genre or tag calls this
 * fire-and-forget right after its own write commits, and `server.ts`'s
 * startup sequence also calls it once at boot (alongside
 * `ensureCoreTaxonomy`) so a row left untranslated by a past DeepL
 * outage, or one that existed before this feature shipped, is not
 * permanently stuck in English waiting for someone to happen to edit
 * that title again.
 *
 * Not scoped to only the rows one particular write just created: it
 * catches up every untranslated row every time, the same "translate
 * whatever's missing" approach `packages/importer`'s own bulk CLI
 * already uses (`ensureNamesWithPolish`).
 *
 * A no-op, not an error, when `DEEPL_API_KEY` isn't configured — see
 * that env var's own doc comment in `packages/config/src/schema.ts`.
 * Its own failure (a DeepL outage, say) never throws — logged and
 * swallowed instead, so it can never fail the catalogue write it
 * follows, nor block the API from starting up. Every catalogue-write
 * caller invokes this with `void`, deliberately fire-and-forget: a
 * translation round trip should not add DeepL's latency to the response
 * time of creating a title or adding a source.
 */
export async function translateUntranslatedTaxonomy(): Promise<void> {
  const deeplApiKey = env().DEEPL_API_KEY;
  if (deeplApiKey === undefined) return;

  try {
    await translateUntranslatedRows(tags, deeplApiKey);
    await translateUntranslatedRows(genres, deeplApiKey);
  } catch (cause: unknown) {
    // A translation failure must not fail catalogue authoring — the row
    // is stored, just without a Polish name yet, exactly the same
    // degraded-but-working state as DEEPL_API_KEY being unset.
    logger.error('Failed to translate genre/tag names', cause, { module: 'catalogue' });
  }
}

/** Deliberate pacing between AniList calls in the resync loop, well under AniList's documented ~30 req/min limit — see `.local/animewatch-migration`'s own `seriesDelayMs` doc comment for the same reasoning applied there. */
const ANILIST_RESYNC_DELAY_MS = 2500;

/**
 * Refreshes `series.anilistScore` for every series with an AniList-linked
 * main entry — AniList's own `averageScore`, converted to this app's
 * 0.00-10.00 scale, kept as a column entirely separate from
 * `averageRating` (real PlayAnime user ratings). Never derived from or
 * merged into user ratings; see `series.anilistScore`'s schema doc
 * comment for the conflation bug this design specifically avoids.
 *
 * Called from two places, matching `translateUntranslatedTaxonomy`'s own
 * pattern: once at server startup (`server.ts`) and then on a recurring
 * timer (every `ANILIST_RESYNC_INTERVAL_MS`, also wired in `server.ts`) —
 * so a score is never more than ~3 hours stale, and a fresh deploy or
 * restart doesn't wait a full interval for the first refresh.
 *
 * One AniList failure never aborts the batch: each title is fetched and
 * written independently, and a failure (AniList down, that id since
 * removed/merged upstream, a transient network error) is logged and
 * skipped rather than losing every title queued after it. Fire-and-forget
 * safe — like `translateUntranslatedTaxonomy`, this must never block or
 * delay the API accepting traffic, and it swallows its own errors.
 */
export async function resyncAnilistScores(): Promise<void> {
  let targets: { seriesId: string; anilistId: number }[];
  try {
    targets = await repository.listSeriesWithAnilistId();
  } catch (cause: unknown) {
    logger.error('Failed to list series for AniList score resync', cause, { module: 'catalogue' });
    return;
  }

  if (targets.length === 0) return;

  logger.info(`Resyncing AniList scores for ${String(targets.length)} series`, { module: 'catalogue' });

  let updated = 0;
  let failed = 0;

  for (const [index, target] of targets.entries()) {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, ANILIST_RESYNC_DELAY_MS));
    }

    try {
      const media = await fetchAniListById(target.anilistId);
      // A title AniList no longer has (merged/removed upstream) is left
      // with whatever score it last had, not reset to null — an AniList-
      // side removal is not evidence the title's OWN last-known score was
      // wrong, and this runs unattended on a timer with no one to review
      // a sudden wave of scores disappearing.
      if (media === null) continue;

      await repository.updateAnilistScore(target.seriesId, mapAverageRating(media.averageScore));
      updated += 1;
    } catch (cause: unknown) {
      failed += 1;
      logger.warn(`Failed to resync AniList score for series ${target.seriesId} (AniList id ${String(target.anilistId)})`, {
        module: 'catalogue',
        'data.error': cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  logger.info(`AniList score resync complete: ${String(updated)} updated, ${String(failed)} failed`, {
    module: 'catalogue',
  });

  if (updated > 0) await invalidateAnimeCaches();
}

/**
 * Links an EXISTING title to an AniList entry and syncs it — sets
 * `anilistId`/`malId`, overwrites the poster/banner with AniList's
 * current images, and ADDS (never removes) any matched genres and any
 * AniList tags, creating a new tag row for one this catalogue hasn't
 * seen before (tags have no curated list to hold back on, unlike
 * genres — see `packages/importer/src/taxonomy.ts`'s own doc comment).
 * Anything already attached that AniList doesn't happen to list —
 * including a genre a human hand-picked — is left untouched.
 */
export async function syncAnimeFromAniList(
  context: AuthoringContext,
  slug: string,
  anilistId: number,
): Promise<AnimeSyncResponse> {
  const { entry, mode } = await requireEditableAnime(context, slug);
  requireDirect(mode);
  await requireTitleNotBlocked(anilistId, null);
  const { media, mapped } = await fetchAndMapAniList(anilistId);
  await requireTitleNotBlocked(null, media.idMal);

  const database = db();
  const resolvedGenres = await resolveOrCreateTaxonomy(database, genres, mapped.genreNames);
  const tagNames = mapped.tags.map((tag) => tag.name);
  const resolvedTags = await resolveOrCreateTaxonomy(database, tags, tagNames, (name) => {
    const tag = mapped.tags.find((t) => t.name === name);
    return { category: tag?.category ?? null, isAdult: tag?.isAdult ?? false };
  });

  // "Added" for the response is computed against what was already
  // attached BEFORE this call, by id — not by slug/name, which would be
  // wrong for a tag with a Polish translation (tagsFor's own `name` field
  // is `namePolish ?? name`, not AniList's raw English name this
  // function keys resolvedTags by; comparing those two directly would
  // report an already-attached translated tag as newly added every time).
  const existingGenreIds = new Set(await repository.attachedGenreIds(entry.id));
  const existingTagIds = new Set(await repository.attachedTagIds(entry.id));
  // Studios have no id to key by (free-text, resolved by slugified name —
  // see `addStudios`), so the "already attached" comparison is by name,
  // lowercased the same way `addStudios`'s own slugify does, to avoid
  // reporting e.g. "Seven Arcs" as newly added a second time over a
  // pre-existing "seven-arcs" credit that differs only in case.
  const existingStudioNames = new Set(
    (await repository.attachedStudioNames(entry.id)).map((name) => name.toLowerCase()),
  );

  const addedGenres = [...resolvedGenres.entries()]
    .filter(([, row]) => !existingGenreIds.has(row.id))
    .map(([name]) => name);
  const addedTags = [...resolvedTags.entries()]
    .filter(([, row]) => !existingTagIds.has(row.id))
    .map(([name]) => name);
  const addedStudios = mapped.studioNames.filter(
    (name) => !existingStudioNames.has(name.toLowerCase()),
  );

  const artworkMeta = await resolveArtworkMeta(mapped.posterUrl, mapped.bannerUrl);

  await repository.syncFromAniList(
    entry.id,
    anilistId,
    media.idMal,
    [...resolvedGenres.values()].map((row) => row.id),
    [...resolvedTags.values()].map((row) => row.id),
    [...mapped.studioNames],
    mapped.posterUrl,
    mapped.bannerUrl,
    artworkMeta,
  );

  await invalidateAnimeCaches();
  void translateUntranslatedTaxonomy();

  return {
    anilistId,
    posterUrl: mapped.posterUrl,
    bannerUrl: mapped.bannerUrl,
    addedGenres,
    addedTags,
    addedStudios,
  };
}

/**
 * Creates a series and, in the common case, its first entry in the same
 * call — mirroring the old single-step "add anime" flow. Every entry
 * belongs to exactly one series, so there is no separate "create a bare
 * title" path: a one-off film still gets a (single-entry) series wrapper.
 */
export async function createAnime(context: AuthoringContext, input: SeriesCreateBody) {
  await requireTitleNotBlocked(input.firstEntry?.anilistId ?? null, input.firstEntry?.malId ?? null);

  const slug = await deriveSlug(input.title);
  const firstEntryArtworkMeta = await resolveArtworkMeta(
    input.firstEntry?.posterUrl ?? null,
    input.firstEntry?.bannerUrl ?? null,
  );

  const result = await repository.createSeries(
    slug,
    input,
    { userId: context.userId, groupId: context.groupId },
    firstEntryArtworkMeta,
  );

  // The catalogue listing is cached by filter hash; a new title would
  // otherwise not appear until the entries expired.
  await invalidateAnimeCaches();
  if (
    input.firstEntry !== undefined &&
    ((input.firstEntry.tags !== undefined && input.firstEntry.tags.length > 0) ||
      (input.firstEntry.genres !== undefined && input.firstEntry.genres.length > 0))
  ) {
    void translateUntranslatedTaxonomy();
  }

  return {
    id: result.series.id,
    slug: result.series.slug,
    ...(result.entry === null ? {} : { firstEntry: { id: result.entry.id, slug: result.entry.slug } }),
  };
}

/**
 * Adds a new entry (a season, cour, movie, OVA...) to an EXISTING series —
 * the "add Season 2" action. Unlike editing an existing entry, this is
 * additive and does not go through the propose-for-review path: any
 * authorized group may add a new release to an existing series, the same
 * way source submission is already open to any group today, since it
 * cannot corrupt anything the series' original owner already added.
 */
export async function addEntry(context: AuthoringContext, seriesSlug: string, input: EntryCreateBody) {
  const series = await animeRepository.findBySlug(seriesSlug);
  if (series === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  await requireTitleNotBlocked(input.anilistId ?? null, input.malId ?? null);

  const slug = await deriveEntrySlug(series.id, input.titleRomaji);
  const artworkMeta = await resolveArtworkMeta(input.posterUrl ?? null, input.bannerUrl ?? null);

  const row = await repository.createEntry(
    series.id,
    slug,
    input,
    { userId: context.userId, groupId: context.groupId },
    artworkMeta,
  );

  await invalidateAnimeCaches();
  if (
    (input.tags !== undefined && input.tags.length > 0) ||
    (input.genres !== undefined && input.genres.length > 0)
  ) {
    void translateUntranslatedTaxonomy();
  }

  return { id: row.id, slug: row.slug };
}

interface Change {
  before: unknown;
  after: unknown;
}

/** True when two values that may be arrays (genres, studios) are actually equal, ignoring order. */
function unequal(before: unknown, after: unknown): boolean {
  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeItems = before as readonly unknown[];
    const afterItems = after as readonly unknown[];
    if (beforeItems.length !== afterItems.length) return true;
    const sortedBefore = [...beforeItems].sort();
    const sortedAfter = [...afterItems].sort();
    return sortedBefore.some((value, index) => value !== sortedAfter[index]);
  }
  return before !== after;
}

/**
 * Real before/after values for every field an entry edit actually touched —
 * only keys present in `input`, and only when the value genuinely changed.
 * This is the fix for the admin module's own older audit write, which only
 * ever recorded `{ changed: Object.keys(input) }` — a list of field names
 * with no record of what they changed from or to.
 */
function diffAnimeEdit(
  before: NonNullable<Awaited<ReturnType<CatalogueRepository['snapshotEntryForDiff']>>>,
  input: EntryEditBody,
): Record<string, Change> {
  const changes: Record<string, Change> = {};

  for (const key of Object.keys(input) as (keyof EntryEditBody)[]) {
    if (key === 'groupId' || key === 'anilistId') continue;
    const afterValue = input[key];
    const beforeValue = before[key as keyof typeof before] ?? null;
    if (unequal(beforeValue, afterValue)) {
      changes[key] = { before: beforeValue, after: afterValue };
    }
  }

  return changes;
}

/** Mirrors `diffAnimeEdit` for episodes. */
function diffEpisodeEdit(
  before: NonNullable<Awaited<ReturnType<CatalogueRepository['snapshotEpisodeForDiff']>>>,
  input: EpisodeEditBody,
): Record<string, Change> {
  const changes: Record<string, Change> = {};

  for (const key of Object.keys(input) as (keyof EpisodeEditBody)[]) {
    if (key === 'groupId' || key === 'thumbnailUrl') continue;
    const afterValue = input[key];
    const beforeValue = before[key] ?? null;
    if (unequal(beforeValue, afterValue)) {
      changes[key] = { before: beforeValue, after: afterValue };
    }
  }

  return changes;
}

/**
 * Loads a series' main entry for editing and decides how the caller may
 * edit it. `:slug` routes are series-scoped, but everything editable here
 * (format, dates, genres, episodes...) lives on an Entry — so this resolves
 * the series' main entry and every downstream write targets that.
 *
 * Three outcomes: staff or the owning group/user get `'direct'` (the existing
 * instant-write path, unchanged). Someone with no editor-or-above group
 * membership at all gets refused outright — 404, not 403, so a non-member
 * cannot even detect the title exists, same as before this feature existed.
 * Everyone in between — an editor-or-above member of SOME group, just not
 * this title's owner — gets `'propose'`: the caller may see and act on the
 * title, but through the pending-review queue rather than a live write.
 */
async function requireEditableAnime(
  context: AuthoringContext,
  slug: string,
): Promise<{ entry: { id: string; slug: string; title: string }; mode: 'direct' | 'propose' }> {
  const series = await animeRepository.findBySlug(slug);

  if (series === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  const entryRows = await repository.listEntriesForSeries(series.id);
  const mainEntry = entryRows.find((row) => row.isMainEntry) ?? entryRows[0];

  if (mainEntry === undefined) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  const entry = { id: mainEntry.id, slug: mainEntry.slug, title: mainEntry.titleRomaji };

  if (context.isStaff) return { entry, mode: 'direct' };

  /*
   * A group may edit what it added directly, and nothing else.
   *
   * Without this any group could rewrite the whole catalogue, which is the
   * obvious failure mode of letting non-staff author titles at all.
   */
  const attribution = await repository.attribution(entry.id);
  const ownedByGroup =
    context.groupId !== null && attribution?.createdByGroupId === context.groupId;
  const ownedByUser = attribution?.createdByUserId === context.userId;

  if (ownedByGroup || ownedByUser) return { entry, mode: 'direct' };

  // `requireAuthoring` already verified editor-or-above rank in this group
  // before setting `context.groupId` — so reaching here with one set means
  // the caller may author on SOME group's behalf, just not for this title.
  if (context.groupId !== null) return { entry, mode: 'propose' };

  throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
}

/**
 * Refuses an operation the proposal queue does not cover — creating new
 * episodes, uploading assets, or re-syncing from AniList. Only `updateAnime`/
 * `updateEpisode` route a non-owning editor to a proposal instead; everything
 * else stays owner-or-staff-only, same as before this feature existed.
 */
function requireDirect(mode: 'direct' | 'propose'): void {
  if (mode === 'propose') {
    throw new AuthorizationError(
      'Możesz zaproponować zmianę tego tytułu, ale nie możesz wykonać tej akcji bezpośrednio.',
      { code: ErrorCode.FORBIDDEN },
    );
  }
}

export async function updateAnime(context: AuthoringContext, slug: string, input: EntryEditBody) {
  const { entry, mode } = await requireEditableAnime(context, slug);

  if (mode === 'propose') {
    return proposeCatalogueEdit(context, 'entry', entry.id, input);
  }

  const before = await repository.snapshotEntryForDiff(entry.id);
  const artworkMeta = await resolveArtworkMeta(input.posterUrl ?? null, input.bannerUrl ?? null);

  const row = await repository.updateEntry(entry.id, input, artworkMeta);
  if (row === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  await invalidateAnimeCaches();
  if (
    (input.tags !== undefined && input.tags.length > 0) ||
    (input.genres !== undefined && input.genres.length > 0)
  ) {
    void translateUntranslatedTaxonomy();
  }

  if (before !== null) {
    await repository.writeAuditEntry({
      action: 'update_anime',
      actorUserId: context.userId,
      targetType: 'entry',
      targetId: entry.id,
      reason: null,
      changes: diffAnimeEdit(before, input),
    });
  }

  return { id: row.id, slug: row.slug };
}

export async function addAsset(
  context: AuthoringContext,
  slug: string,
  input: MediaAssetUpsertBody,
) {
  const { entry, mode } = await requireEditableAnime(context, slug);
  requireDirect(mode);

  // `trailer` is a video, not a still image — sharp cannot decode it (and
  // would just fail the fetch after downloading the whole file for
  // nothing), so metadata is only ever attempted for the image kinds.
  const meta = input.kind === 'trailer' ? null : await fetchImageMeta(input.url);

  const row = await repository.upsertAsset(entry.id, input, meta);

  if (row === null) throw new Error('Asset insert returned no row.');

  await invalidateAnimeCaches();
  return { id: row.id };
}

/* -------------------------------------------------------------------------- */
/* Episodes                                                                    */
/* -------------------------------------------------------------------------- */

export async function listEpisodesForEditing(context: AuthoringContext, slug: string) {
  // Both modes may read: a non-owning editor needs to see the episode list
  // to know what to propose against, even though they cannot write to it
  // directly. `requireEditableAnime` still 404s anyone with no standing at
  // all to be here.
  const { entry } = await requireEditableAnime(context, slug);
  const rows = await repository.listEpisodesForEditing(entry.id);

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    airedAt: row.airedAt,
    durationSeconds: row.durationSeconds,
    isFiller: row.isFiller,
    isRecap: row.isRecap,
    introStartSeconds: row.introStartSeconds,
    introEndSeconds: row.introEndSeconds,
    outroStartSeconds: row.outroStartSeconds,
    sourceCount: row.sourceCount,
    pendingSourceCount: row.pendingSourceCount,
  }));
}

export async function createEpisode(
  context: AuthoringContext,
  slug: string,
  input: EpisodeCreateBody,
) {
  const { entry, mode } = await requireEditableAnime(context, slug);
  requireDirect(mode);

  if (await repository.episodeNumberTaken(entry.id, input.number)) {
    throw new ConflictError(`Odcinek ${String(input.number)} już istnieje.`, {
      code: ErrorCode.ALREADY_EXISTS,
    });
  }

  // An intro that ends before it starts would make the skip control seek
  // backwards, so it is rejected rather than stored and worked around.
  assertMarkersOrdered(input.introStartSeconds, input.introEndSeconds);

  const row = await repository.createEpisode(entry.id, input, {
    userId: context.userId,
    groupId: context.groupId,
  });

  await repository.writeAuditEntry({
    action: 'create_episode',
    actorUserId: context.userId,
    targetType: 'episode',
    targetId: row.id,
    reason: null,
    changes: { number: { before: null, after: row.number } },
  });

  await invalidateAnimeCaches();
  return { id: row.id, number: row.number };
}

export async function createEpisodeRange(
  context: AuthoringContext,
  slug: string,
  input: EpisodeBulkCreateBody,
) {
  const { entry, mode } = await requireEditableAnime(context, slug);
  requireDirect(mode);

  if (input.to < input.from) {
    throw new ValidationError('Zakres odcinków jest nieprawidłowy.', [
      { path: 'to', message: 'Musi być większe lub równe wartości początkowej.' },
    ]);
  }

  // Bounded so one request cannot insert an unreasonable number of rows.
  if (input.to - input.from >= 500) {
    throw new ValidationError('Zakres nie może obejmować więcej niż 500 odcinków.', [
      { path: 'to', message: 'Zakres zbyt duży.' },
    ]);
  }

  const result = await repository.createEpisodeRange(
    entry.id,
    input.from,
    input.to,
    input.durationSeconds ?? null,
    { userId: context.userId, groupId: context.groupId },
  );

  // One summary row on the ENTRY, not one per created episode — a range
  // can create up to 500 rows in one call, and 500 near-identical audit
  // entries would bury everything else in a title's history. Skipped when
  // nothing was actually created (every number in the range already
  // existed), so a no-op re-run of the same range doesn't add noise.
  if (result.created > 0) {
    await repository.writeAuditEntry({
      action: 'create_episode',
      actorUserId: context.userId,
      targetType: 'entry',
      targetId: entry.id,
      reason: null,
      changes: {
        range: { before: null, after: `${String(input.from)}-${String(input.to)}` },
        created: { before: null, after: result.created },
        ...(result.skipped.length > 0 ? { skipped: { before: null, after: result.skipped.join(', ') } } : {}),
      },
    });
  }

  await invalidateAnimeCaches();
  return result;
}

export async function updateEpisode(
  context: AuthoringContext,
  episodeId: string,
  input: EpisodeEditBody,
) {
  const { episode, mode } = await requireEditableEpisode(context, episodeId);

  if (mode === 'propose') {
    return proposeCatalogueEdit(context, 'episode', episode.id, input);
  }

  assertMarkersOrdered(input.introStartSeconds, input.introEndSeconds);

  if (input.number !== undefined && input.number !== episode.number) {
    if (await repository.episodeNumberTaken(episode.entryId, input.number)) {
      throw new ConflictError(`Odcinek ${String(input.number)} już istnieje.`, {
        code: ErrorCode.ALREADY_EXISTS,
      });
    }
  }

  const before = await repository.snapshotEpisodeForDiff(episodeId);

  const row = await repository.updateEpisode(episodeId, input);
  if (row === null) throw new NotFoundError('Nie znaleziono tego odcinka.');

  await invalidateAnimeCaches();

  if (before !== null) {
    await repository.writeAuditEntry({
      action: 'update_episode',
      actorUserId: context.userId,
      targetType: 'episode',
      targetId: episodeId,
      reason: null,
      changes: diffEpisodeEdit(before, input),
    });
  }

  return { id: row.id };
}

export async function deleteEpisode(context: AuthoringContext, episodeId: string) {
  const { episode, mode } = await requireEditableEpisode(context, episodeId);
  requireDirect(mode);

  const row = await repository.softDeleteEpisode(episodeId);
  if (row === null) throw new NotFoundError('Nie znaleziono tego odcinka.');

  await repository.writeAuditEntry({
    action: 'delete_episode',
    actorUserId: context.userId,
    targetType: 'episode',
    targetId: episodeId,
    reason: null,
    changes: { number: { before: episode.number, after: null } },
  });

  await invalidateAnimeCaches();
  return { success: true };
}

/**
 * Loads an episode and decides how the caller may edit it. Mirrors
 * `requireEditableAnime` — see its own doc comment for the three outcomes.
 */
async function requireEditableEpisode(
  context: AuthoringContext,
  episodeId: string,
): Promise<{ episode: NonNullable<Awaited<ReturnType<typeof repository.findEpisode>>>; mode: 'direct' | 'propose' }> {
  const episode = await repository.findEpisode(episodeId);

  if (episode === null) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }

  if (context.isStaff) return { episode, mode: 'direct' };

  const ownedByGroup =
    context.groupId !== null && episode.createdByGroupId === context.groupId;
  const ownedByUser = episode.createdByUserId === context.userId;

  if (ownedByGroup || ownedByUser) return { episode, mode: 'direct' };

  if (context.groupId !== null) return { episode, mode: 'propose' };

  throw new NotFoundError('Nie znaleziono tego odcinka.', {
    code: ErrorCode.EPISODE_NOT_FOUND,
  });
}

/** Rejects an intro range that ends before it begins. */
function assertMarkersOrdered(start: number | null | undefined, end: number | null | undefined): void {
  if (start == null || end == null) return;

  if (end <= start) {
    throw new ValidationError('Koniec intro musi następować po jego początku.', [
      { path: 'introEndSeconds', message: 'Musi być większe niż początek intro.' },
    ]);
  }
}

/* -------------------------------------------------------------------------- */
/* Cross-group edit proposals                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Stores a pending proposal instead of writing live — reached from
 * `updateAnime`/`updateEpisode` when the caller may author for some group,
 * just not this title's owner. Validated eagerly, against the SAME rules
 * the direct-write path enforces (episode-number-taken, marker ordering) —
 * a stale conflict can still surface again at approval time if the live
 * data moved on, but an obviously-broken proposal is refused immediately
 * rather than only discovered by staff much later.
 */
async function proposeCatalogueEdit(
  context: AuthoringContext,
  targetType: 'entry' | 'episode',
  targetId: string,
  input: EntryEditBody | EpisodeEditBody,
): Promise<ProposeAnimeEditResponse> {
  let entryId: string;
  let ownerGroupId: string | null;

  if (targetType === 'entry') {
    const attribution = await repository.attribution(targetId);
    entryId = targetId;
    ownerGroupId = attribution?.createdByGroupId ?? null;
  } else {
    const episode = await repository.findEpisode(targetId);
    if (episode === null) throw new NotFoundError('Nie znaleziono tego odcinka.');

    const episodeInput = input as EpisodeEditBody;
    assertMarkersOrdered(episodeInput.introStartSeconds, episodeInput.introEndSeconds);
    if (episodeInput.number !== undefined && episodeInput.number !== episode.number) {
      if (await repository.episodeNumberTaken(episode.entryId, episodeInput.number)) {
        throw new ConflictError(`Odcinek ${String(episodeInput.number)} już istnieje.`, {
          code: ErrorCode.ALREADY_EXISTS,
        });
      }
    }

    entryId = episode.entryId;
    ownerGroupId = episode.createdByGroupId;
  }

  const recipientUserIds = ownerGroupId === null ? [] : await translatorRepository.leaderUserIds(ownerGroupId);
  const entry = await repository.findEntryById(entryId);

  const row = await repository.createProposal(
    {
      targetType,
      targetId,
      proposedByUserId: context.userId,
      proposedByGroupId: context.groupId,
      changes: input,
    },
    {
      recipientUserIds,
      title: 'Nowa propozycja zmiany',
      body: `Zaproponowano zmianę dla „${entry?.title ?? 'tytułu'}”. Sprawdź i zdecyduj.`,
      href: entry === null ? '/admin/dashboard' : `/catalogue/manage/${entry.slug}`,
    },
  );

  return { proposalId: row.id, status: 'pending' };
}

/** The full staff review queue. */
export async function listProposalQueue(): Promise<CatalogueProposalQueue> {
  const rows = await repository.listPendingProposals();

  const proposals = await Promise.all(
    rows.map(async (row) => {
      const { entryId, episodeNumber } = await resolveProposalTarget(row.targetType, row.targetId);
      const entry = entryId === null ? null : await repository.findEntryById(entryId);

      return {
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        seriesSlug: entry?.slug ?? '',
        seriesTitle: entry?.title ?? '',
        episodeNumber,
        proposedByUsername: row.proposedByUsername,
        proposedByGroupName: row.proposedByGroupName,
        changes: row.changes as Record<string, unknown>,
        status: row.status,
        decidedByUsername: null,
        decidedAt: null,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  );

  return { proposals };
}

/** Resolves a proposal's polymorphic target back to an entry id (and episode number, for episode targets). */
async function resolveProposalTarget(
  targetType: 'entry' | 'episode',
  targetId: string,
): Promise<{ entryId: string | null; episodeNumber: number | null }> {
  if (targetType === 'entry') return { entryId: targetId, episodeNumber: null };

  const episode = await repository.findEpisode(targetId);
  return { entryId: episode?.entryId ?? null, episodeNumber: episode?.number ?? null };
}

/**
 * Approves or rejects a pending proposal. On approve, applies `changes` via
 * the EXISTING `updateAnime`/`updateEpisode` repository methods — reusing
 * every current field-patch/genre/studio/artwork rule unchanged, so a
 * proposal can never bypass validation a direct edit is subject to — then
 * writes the same full before/after audit entry a direct edit would. On
 * reject, no catalogue write happens at all.
 */
export async function decideCatalogueProposal(
  actorUserId: string,
  proposalId: string,
  decision: CatalogueProposalDecisionBody,
): Promise<{ success: true }> {
  const proposal = await repository.findProposal(proposalId);
  if (proposal?.status !== 'pending') {
    throw new NotFoundError('Nie znaleziono tej propozycji.');
  }

  if (!decision.approve && (decision.reason?.trim().length ?? 0) === 0) {
    throw new ValidationError('Podaj powód odrzucenia.', [
      { path: 'reason', message: 'Wymagany przy odrzuceniu.' },
    ]);
  }

  if (decision.approve) {
    const changes = proposal.changes as EntryEditBody & EpisodeEditBody;

    if (proposal.targetType === 'entry') {
      const before = await repository.snapshotEntryForDiff(proposal.targetId);
      const artworkMeta = await resolveArtworkMeta(changes.posterUrl ?? null, changes.bannerUrl ?? null);
      const row = await repository.updateEntry(proposal.targetId, changes, artworkMeta);
      if (row === null) throw new NotFoundError('Nie znaleziono tego anime.');

      if (
        (changes.tags !== undefined && changes.tags.length > 0) ||
        (changes.genres !== undefined && changes.genres.length > 0)
      ) {
        void translateUntranslatedTaxonomy();
      }

      if (before !== null) {
        await repository.writeAuditEntry({
          action: 'approve_catalogue_edit',
          actorUserId,
          targetType: 'entry',
          targetId: proposal.targetId,
          reason: decision.reason ?? null,
          changes: diffAnimeEdit(before, changes),
        });
      }
    } else {
      const before = await repository.snapshotEpisodeForDiff(proposal.targetId);
      const row = await repository.updateEpisode(proposal.targetId, changes);
      if (row === null) throw new NotFoundError('Nie znaleziono tego odcinka.');

      if (before !== null) {
        await repository.writeAuditEntry({
          action: 'approve_catalogue_edit',
          actorUserId,
          targetType: 'episode',
          targetId: proposal.targetId,
          reason: decision.reason ?? null,
          changes: diffEpisodeEdit(before, changes),
        });
      }
    }

    await invalidateAnimeCaches();
  }

  const decided = await repository.decideProposal(proposalId, actorUserId, decision.approve, decision.reason ?? null, {
    title: decision.approve ? 'Propozycja zaakceptowana' : 'Propozycja odrzucona',
    body: decision.approve
      ? 'Twoja proponowana zmiana została zastosowana.'
      : `Twoja proponowana zmiana została odrzucona.${decision.reason ? ` Powód: ${decision.reason}` : ''}`,
    href: '/notifications',
  });

  if (decided === null) {
    throw new ConflictError('Ta propozycja została już rozpatrzona.', { code: ErrorCode.ALREADY_EXISTS });
  }

  return { success: true };
}

/** A title's own audit trail, covering its main entry and all of its episodes — readable by staff OR the owning group. */
export async function animeAuditTrail(context: AuthoringContext, slug: string): Promise<CatalogueAuditTrail> {
  // Reuses the same series -> main-entry resolution + ownership check
  // `requireEditableAnime` already does, rather than a second copy of it —
  // a non-owning, non-staff caller is refused the exact same way here.
  const { entry } = await requireEditableAnime(context, slug);

  const episodeRows = await repository.listEpisodesForEditing(entry.id);
  const episodeIds = episodeRows.map((row) => row.id);

  const rows = await repository.entryAuditTrail(entry.id, episodeIds);

  return {
    entries: rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType as 'entry' | 'episode',
      targetId: row.targetId,
      actorUsername: row.actorUsername,
      reason: row.reason,
      changes: ((row.metadata as { changes?: unknown } | null)?.changes ?? {}) as Record<
        string,
        { before: unknown; after: unknown }
      >,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
