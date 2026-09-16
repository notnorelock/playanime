import type {
  AnimeCreateBody,
  AnimeEditBody,
  EpisodeBulkCreateBody,
  EpisodeCreateBody,
  EpisodeEditBody,
  MediaAssetUpsertBody,
} from '@playanime/contracts';
import { AnimeRepository, CatalogueRepository, db } from '@playanime/database';
import {
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
    titlePolish: row.titlePolish,
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
