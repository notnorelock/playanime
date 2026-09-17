import type {
  AnimeAutofillResponse,
  AnimeCreateBody,
  AnimeEditBody,
  AnimeSearchResponse,
  AnimeSyncResponse,
  CatalogueAuditTrail,
  CatalogueProposalDecisionBody,
  CatalogueProposalQueue,
  EpisodeBulkCreateBody,
  EpisodeCreateBody,
  EpisodeEditBody,
  MediaAssetUpsertBody,
  ProposeAnimeEditResponse,
} from '@playanime/contracts';
import { AnimeRepository, CatalogueRepository, TranslatorRepository, db, genres, tags } from '@playanime/database';
import { isNull, eq } from 'drizzle-orm';
import { env } from '@playanime/config';
import type { AniListMedia, MappedAnime } from '@playanime/importer';
import {
  fetchAniListById,
  mapAniListMedia,
  mapFormat,
  mapSeason,
  mapStatus,
  resolveKnownTaxonomy,
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

  if (!(await repository.slugTaken(base))) return base;

  for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS; suffix += 1) {
    const candidate = `${base.slice(0, 92)}-${String(suffix)}`;
    if (!(await repository.slugTaken(candidate))) return candidate;
  }

  throw new ConflictError('Nie udało się utworzyć unikalnego adresu dla tego tytułu.');
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
      format: row.format as 'tv' | 'tv_short' | 'movie' | 'ova' | 'ona' | 'special' | 'music',
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
 * The full autofill payload for one AniList id, picked from a search
 * result. Genre names are resolved to this app's own genre slugs by
 * English `name` column match — the same lookup
 * `packages/importer/src/sync.ts`'s bulk sync already does — never
 * auto-created here: an AniList genre this app doesn't know yet is
 * simply omitted, since this is a read-only preview, not a write.
 */
export async function autofillFromAniList(anilistId: number): Promise<AnimeAutofillResponse> {
  const { media, mapped, format } = await fetchAndMapAniList(anilistId);

  const knownGenres = await resolveKnownTaxonomy(db(), genres, mapped.genreNames);

  return {
    titleRomaji: mapped.titleRomaji,
    titleEnglish: mapped.titleEnglish,
    titleNative: mapped.titleNative,
    synopsis: mapped.synopsis,
    format,
    status: mapStatus(media.status),
    season: mapSeason(media.season),
    seasonYear: mapped.seasonYear,
    episodeCount: mapped.episodeCount,
    durationMinutes: mapped.durationMinutes,
    isAdult: mapped.isAdult,
    genres: [...knownGenres.values()].map((row) => row.slug),
    studios: [...mapped.studioNames],
    tags: mapped.tags.map((tag) => tag.name),
    posterUrl: mapped.posterUrl,
    bannerUrl: mapped.bannerUrl,
    malId: mapped.malId,
  };
}

/**
 * Translates any tag with no Polish name yet, via DeepL — called after
 * any write that can create a tag (an AniList sync, or a translator
 * hand-typing a new one in the authoring form via `applyTags`'s
 * create-on-demand). Not scoped to only the tags a single call just
 * created: it catches up every untranslated row, the same "translate
 * whatever's missing" approach `packages/importer`'s own bulk CLI
 * already uses (`ensureNamesWithPolish`), so a tag that slipped through
 * untranslated for any reason self-heals on the next write rather than
 * staying English forever.
 *
 * A no-op, not an error, when `DEEPL_API_KEY` isn't configured — see
 * that env var's own doc comment in `packages/config/src/schema.ts`.
 * Runs after the caller's own write has already committed, and its own
 * failure (a DeepL outage, say) must never fail the catalogue write it
 * follows — logged and swallowed, not rethrown. Callers invoke this with
 * `void`, deliberately fire-and-forget: a translation round trip should
 * not add DeepL's latency to the response time of creating a title or
 * adding a source, and every caller has already committed its own write
 * by the time this runs regardless of how long it takes.
 */
async function translateUntranslatedTags(): Promise<void> {
  const deeplApiKey = env().DEEPL_API_KEY;
  if (deeplApiKey === undefined) return;

  try {
    const database = db();
    const untranslated = await database
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(isNull(tags.namePolish));

    if (untranslated.length === 0) return;

    const translated = await translateToPolish(
      deeplApiKey,
      untranslated.map((row) => row.name),
    );

    for (let i = 0; i < untranslated.length; i += 1) {
      const row = untranslated[i];
      const polish = translated[i];
      if (row === undefined || polish === undefined) continue;
      await database.update(tags).set({ namePolish: polish }).where(eq(tags.id, row.id));
    }
  } catch (cause: unknown) {
    // A translation failure must not fail catalogue authoring — the tag
    // is stored, just without a Polish name yet, exactly the same
    // degraded-but-working state as DEEPL_API_KEY being unset.
    logger.error('Failed to translate tag names', cause, { module: 'catalogue' });
  }
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
  const { title, mode } = await requireEditableAnime(context, slug);
  requireDirect(mode);
  const { media, mapped } = await fetchAndMapAniList(anilistId);

  const database = db();
  const knownGenres = await resolveKnownTaxonomy(database, genres, mapped.genreNames);
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
  const existingGenreIds = new Set(await repository.attachedGenreIds(title.id));
  const existingTagIds = new Set(await repository.attachedTagIds(title.id));
  // Studios have no id to key by (free-text, resolved by slugified name —
  // see `addStudios`), so the "already attached" comparison is by name,
  // lowercased the same way `addStudios`'s own slugify does, to avoid
  // reporting e.g. "Seven Arcs" as newly added a second time over a
  // pre-existing "seven-arcs" credit that differs only in case.
  const existingStudioNames = new Set(
    (await repository.attachedStudioNames(title.id)).map((name) => name.toLowerCase()),
  );

  const addedGenres = [...knownGenres.entries()]
    .filter(([, row]) => !existingGenreIds.has(row.id))
    .map(([, row]) => row.slug);
  const addedTags = [...resolvedTags.entries()]
    .filter(([, row]) => !existingTagIds.has(row.id))
    .map(([name]) => name);
  const addedStudios = mapped.studioNames.filter(
    (name) => !existingStudioNames.has(name.toLowerCase()),
  );

  await repository.syncFromAniList(
    title.id,
    anilistId,
    media.idMal,
    [...knownGenres.values()].map((row) => row.id),
    [...resolvedTags.values()].map((row) => row.id),
    [...mapped.studioNames],
    mapped.posterUrl,
    mapped.bannerUrl,
  );

  await invalidateAnimeCaches();
  void translateUntranslatedTags();

  return {
    anilistId,
    posterUrl: mapped.posterUrl,
    bannerUrl: mapped.bannerUrl,
    addedGenres,
    addedTags,
    addedStudios,
  };
}

export async function createAnime(context: AuthoringContext, input: AnimeCreateBody) {
  const slug = await deriveSlug(input.titleRomaji);

  try {
    const row = await repository.createAnime(slug, input, {
      userId: context.userId,
      groupId: context.groupId,
    });

    // The catalogue listing is cached by filter hash; a new title would
    // otherwise not appear until the entries expired.
    await invalidateAnimeCaches();
    if (input.tags !== undefined && input.tags.length > 0) void translateUntranslatedTags();

    return { id: row.id, slug: row.slug };
  } catch (cause: unknown) {
    // `applyGenres` throws on an unknown slug rather than dropping it silently.
    if (cause instanceof Error && cause.message.startsWith('Unknown genre slugs:')) {
      throw new ValidationError('Nieznane gatunki.', [
        { path: 'genres', message: cause.message.replace('Unknown genre slugs: ', '') },
      ]);
    }
    throw cause;
  }
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
 * Real before/after values for every field an anime edit actually touched —
 * only keys present in `input`, and only when the value genuinely changed.
 * This is the fix for the admin module's own older audit write, which only
 * ever recorded `{ changed: Object.keys(input) }` — a list of field names
 * with no record of what they changed from or to.
 */
function diffAnimeEdit(
  before: NonNullable<Awaited<ReturnType<CatalogueRepository['snapshotAnimeForDiff']>>>,
  input: AnimeEditBody,
): Record<string, Change> {
  const changes: Record<string, Change> = {};

  for (const key of Object.keys(input) as (keyof AnimeEditBody)[]) {
    if (key === 'groupId' || key === 'anilistId') continue;
    const afterValue = input[key];
    const beforeValue = before[key] ?? null;
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
 * Loads a title for editing and decides how the caller may edit it.
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
): Promise<{ title: NonNullable<Awaited<ReturnType<typeof animeRepository.findBySlug>>>; mode: 'direct' | 'propose' }> {
  const title = await animeRepository.findBySlug(slug);

  if (title === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  if (context.isStaff) return { title, mode: 'direct' };

  /*
   * A group may edit what it added directly, and nothing else.
   *
   * Without this any group could rewrite the whole catalogue, which is the
   * obvious failure mode of letting non-staff author titles at all.
   */
  const attribution = await repository.attribution(title.id);
  const ownedByGroup =
    context.groupId !== null && attribution?.createdByGroupId === context.groupId;
  const ownedByUser = attribution?.createdByUserId === context.userId;

  if (ownedByGroup || ownedByUser) return { title, mode: 'direct' };

  // `requireAuthoring` already verified editor-or-above rank in this group
  // before setting `context.groupId` — so reaching here with one set means
  // the caller may author on SOME group's behalf, just not for this title.
  if (context.groupId !== null) return { title, mode: 'propose' };

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

export async function updateAnime(context: AuthoringContext, slug: string, input: AnimeEditBody) {
  const { title, mode } = await requireEditableAnime(context, slug);

  if (mode === 'propose') {
    return proposeCatalogueEdit(context, 'anime', title.id, input);
  }

  const before = await repository.snapshotAnimeForDiff(title.id);

  try {
    const row = await repository.updateAnime(title.id, input);
    if (row === null) {
      throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
    }

    await invalidateAnimeCaches();
    if (input.tags !== undefined && input.tags.length > 0) void translateUntranslatedTags();

    if (before !== null) {
      await repository.writeAuditEntry({
        action: 'update_anime',
        actorUserId: context.userId,
        targetType: 'anime',
        targetId: title.id,
        reason: null,
        changes: diffAnimeEdit(before, input),
      });
    }

    return { id: row.id, slug: row.slug };
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.message.startsWith('Unknown genre slugs:')) {
      throw new ValidationError('Nieznane gatunki.', [
        { path: 'genres', message: cause.message.replace('Unknown genre slugs: ', '') },
      ]);
    }
    throw cause;
  }
}

export async function addAsset(
  context: AuthoringContext,
  slug: string,
  input: MediaAssetUpsertBody,
) {
  const { title, mode } = await requireEditableAnime(context, slug);
  requireDirect(mode);
  const row = await repository.upsertAsset(title.id, input);

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
  const { title } = await requireEditableAnime(context, slug);
  const rows = await repository.listEpisodesForEditing(title.id);

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
  const { title, mode } = await requireEditableAnime(context, slug);
  requireDirect(mode);

  if (await repository.episodeNumberTaken(title.id, input.number)) {
    throw new ConflictError(`Odcinek ${String(input.number)} już istnieje.`, {
      code: ErrorCode.ALREADY_EXISTS,
    });
  }

  // An intro that ends before it starts would make the skip control seek
  // backwards, so it is rejected rather than stored and worked around.
  assertMarkersOrdered(input.introStartSeconds, input.introEndSeconds);

  const row = await repository.createEpisode(title.id, input, {
    userId: context.userId,
    groupId: context.groupId,
  });

  await invalidateAnimeCaches();
  return { id: row.id, number: row.number };
}

export async function createEpisodeRange(
  context: AuthoringContext,
  slug: string,
  input: EpisodeBulkCreateBody,
) {
  const { title, mode } = await requireEditableAnime(context, slug);
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
    title.id,
    input.from,
    input.to,
    input.durationSeconds ?? null,
    { userId: context.userId, groupId: context.groupId },
  );

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
    if (await repository.episodeNumberTaken(episode.animeId, input.number)) {
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
  const { mode } = await requireEditableEpisode(context, episodeId);
  requireDirect(mode);

  const row = await repository.softDeleteEpisode(episodeId);
  if (row === null) throw new NotFoundError('Nie znaleziono tego odcinka.');

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
  targetType: 'anime' | 'episode',
  targetId: string,
  input: AnimeEditBody | EpisodeEditBody,
): Promise<ProposeAnimeEditResponse> {
  let animeId: string;
  let ownerGroupId: string | null;

  if (targetType === 'anime') {
    const attribution = await repository.attribution(targetId);
    animeId = targetId;
    ownerGroupId = attribution?.createdByGroupId ?? null;
  } else {
    const episode = await repository.findEpisode(targetId);
    if (episode === null) throw new NotFoundError('Nie znaleziono tego odcinka.');

    const episodeInput = input as EpisodeEditBody;
    assertMarkersOrdered(episodeInput.introStartSeconds, episodeInput.introEndSeconds);
    if (episodeInput.number !== undefined && episodeInput.number !== episode.number) {
      if (await repository.episodeNumberTaken(episode.animeId, episodeInput.number)) {
        throw new ConflictError(`Odcinek ${String(episodeInput.number)} już istnieje.`, {
          code: ErrorCode.ALREADY_EXISTS,
        });
      }
    }

    animeId = episode.animeId;
    ownerGroupId = episode.createdByGroupId;
  }

  const recipientUserIds = ownerGroupId === null ? [] : await translatorRepository.leaderUserIds(ownerGroupId);
  const anime = await animeRepository.findById(animeId);

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
      body: `Zaproponowano zmianę dla „${anime?.title ?? 'tytułu'}”. Sprawdź i zdecyduj.`,
      href: anime === null ? '/admin/dashboard' : `/catalogue/manage/${anime.slug}`,
    },
  );

  return { proposalId: row.id, status: 'pending' };
}

/** The full staff review queue. */
export async function listProposalQueue(): Promise<CatalogueProposalQueue> {
  const rows = await repository.listPendingProposals();

  const proposals = await Promise.all(
    rows.map(async (row) => {
      const { animeId, episodeNumber } = await resolveProposalTarget(row.targetType, row.targetId);
      const anime = animeId === null ? null : await animeRepository.findById(animeId);

      return {
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        animeSlug: anime?.slug ?? '',
        animeTitle: anime?.title ?? '',
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

/** Resolves a proposal's polymorphic target back to an anime id (and episode number, for episode targets). */
async function resolveProposalTarget(
  targetType: 'anime' | 'episode',
  targetId: string,
): Promise<{ animeId: string | null; episodeNumber: number | null }> {
  if (targetType === 'anime') return { animeId: targetId, episodeNumber: null };

  const episode = await repository.findEpisode(targetId);
  return { animeId: episode?.animeId ?? null, episodeNumber: episode?.number ?? null };
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
    const changes = proposal.changes as AnimeEditBody & EpisodeEditBody;

    if (proposal.targetType === 'anime') {
      const before = await repository.snapshotAnimeForDiff(proposal.targetId);
      const row = await repository.updateAnime(proposal.targetId, changes);
      if (row === null) throw new NotFoundError('Nie znaleziono tego anime.');

      if (changes.tags !== undefined && changes.tags.length > 0) void translateUntranslatedTags();

      if (before !== null) {
        await repository.writeAuditEntry({
          action: 'approve_catalogue_edit',
          actorUserId,
          targetType: 'anime',
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

/** A title's own audit trail, covering the anime row and all of its episodes — readable by staff OR the owning group. */
export async function animeAuditTrail(context: AuthoringContext, slug: string): Promise<CatalogueAuditTrail> {
  const title = await animeRepository.findBySlug(slug);
  if (title === null) throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });

  if (!context.isStaff) {
    const attribution = await repository.attribution(title.id);
    const ownedByGroup = context.groupId !== null && attribution?.createdByGroupId === context.groupId;
    const ownedByUser = attribution?.createdByUserId === context.userId;
    if (!ownedByGroup && !ownedByUser) {
      throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
    }
  }

  const episodeRows = await repository.listEpisodesForEditing(title.id);
  const episodeIds = episodeRows.map((row) => row.id);

  const rows = await repository.animeAuditTrail(title.id, episodeIds);

  return {
    entries: rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType as 'anime' | 'episode',
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
