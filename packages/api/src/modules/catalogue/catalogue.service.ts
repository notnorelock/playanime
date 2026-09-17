import type {
  AnimeAutofillResponse,
  AnimeCreateBody,
  AnimeEditBody,
  AnimeSearchResponse,
  AnimeSyncResponse,
  EpisodeBulkCreateBody,
  EpisodeCreateBody,
  EpisodeEditBody,
  MediaAssetUpsertBody,
} from '@playanime/contracts';
import { AnimeRepository, CatalogueRepository, db, genres, tags } from '@playanime/database';
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
} from '@playanime/importer';
import {
  AppError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  ValidationError,
  slugify,
} from '@playanime/shared';
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
    posterUrl: mapped.posterUrl,
    bannerUrl: mapped.bannerUrl,
    malId: mapped.malId,
  };
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
  const title = await requireEditableAnime(context, slug);
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

  const addedGenres = [...knownGenres.entries()]
    .filter(([, row]) => !existingGenreIds.has(row.id))
    .map(([, row]) => row.slug);
  const addedTags = [...resolvedTags.entries()]
    .filter(([, row]) => !existingTagIds.has(row.id))
    .map(([name]) => name);

  await repository.syncFromAniList(
    title.id,
    anilistId,
    media.idMal,
    [...knownGenres.values()].map((row) => row.id),
    [...resolvedTags.values()].map((row) => row.id),
    mapped.posterUrl,
    mapped.bannerUrl,
  );

  await invalidateAnimeCaches();

  return {
    anilistId,
    posterUrl: mapped.posterUrl,
    bannerUrl: mapped.bannerUrl,
    addedGenres,
    addedTags,
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

/** Loads a title for editing and checks the caller may edit it. */
async function requireEditableAnime(context: AuthoringContext, slug: string) {
  const title = await animeRepository.findBySlug(slug);

  if (title === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  if (context.isStaff) return title;

  /*
   * A group may edit what it added, and nothing else.
   *
   * Without this any group could rewrite the whole catalogue, which is the
   * obvious failure mode of letting non-staff author titles at all.
   */
  const attribution = await repository.attribution(title.id);
  const ownedByGroup =
    context.groupId !== null && attribution?.createdByGroupId === context.groupId;
  const ownedByUser = attribution?.createdByUserId === context.userId;

  if (!ownedByGroup && !ownedByUser) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  return title;
}

export async function updateAnime(context: AuthoringContext, slug: string, input: AnimeEditBody) {
  const title = await requireEditableAnime(context, slug);

  try {
    const row = await repository.updateAnime(title.id, input);
    if (row === null) {
      throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
    }

    await invalidateAnimeCaches();
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
  const title = await requireEditableAnime(context, slug);
  const row = await repository.upsertAsset(title.id, input);

  if (row === null) throw new Error('Asset insert returned no row.');

  await invalidateAnimeCaches();
  return { id: row.id };
}

/* -------------------------------------------------------------------------- */
/* Episodes                                                                    */
/* -------------------------------------------------------------------------- */

export async function listEpisodesForEditing(context: AuthoringContext, slug: string) {
  const title = await requireEditableAnime(context, slug);
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
  const title = await requireEditableAnime(context, slug);

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
  const title = await requireEditableAnime(context, slug);

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
  const episode = await requireEditableEpisode(context, episodeId);

  assertMarkersOrdered(input.introStartSeconds, input.introEndSeconds);

  if (input.number !== undefined && input.number !== episode.number) {
    if (await repository.episodeNumberTaken(episode.animeId, input.number)) {
      throw new ConflictError(`Odcinek ${String(input.number)} już istnieje.`, {
        code: ErrorCode.ALREADY_EXISTS,
      });
    }
  }

  const row = await repository.updateEpisode(episodeId, input);
  if (row === null) throw new NotFoundError('Nie znaleziono tego odcinka.');

  await invalidateAnimeCaches();
  return { id: row.id };
}

export async function deleteEpisode(context: AuthoringContext, episodeId: string) {
  await requireEditableEpisode(context, episodeId);

  const row = await repository.softDeleteEpisode(episodeId);
  if (row === null) throw new NotFoundError('Nie znaleziono tego odcinka.');

  await invalidateAnimeCaches();
  return { success: true };
}

/** Loads an episode and checks the caller may edit it. */
async function requireEditableEpisode(context: AuthoringContext, episodeId: string) {
  const episode = await repository.findEpisode(episodeId);

  if (episode === null) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }

  if (context.isStaff) return episode;

  const ownedByGroup =
    context.groupId !== null && episode.createdByGroupId === context.groupId;
  const ownedByUser = episode.createdByUserId === context.userId;

  if (!ownedByGroup && !ownedByUser) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }

  return episode;
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
