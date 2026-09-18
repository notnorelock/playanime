import type { LibraryQuery, LibraryUpsertBody, ProgressUpsertBody } from '@playanime/contracts';
import { db, LibraryRepository } from '@playanime/database';
import { clampPageSize, ErrorCode, NotFoundError, now } from '@playanime/shared';
import { toContinueWatching, toLibraryEntry, toProgress } from './library.mapper.js';

const repository = new LibraryRepository(db());

export async function listLibrary(userId: string, query: LibraryQuery) {
  const limit = clampPageSize(query.limit);
  const parsed = query.cursor === undefined ? null : new Date(query.cursor);
  const before = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const rows = await repository.list(userId, query.status, limit, before);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(toLibraryEntry),
    nextCursor: hasMore ? (pageRows.at(-1)?.updatedAt.toISOString() ?? null) : null,
    hasMore,
  };
}

/** A series' status in the caller's own library, or `null` if it was never added. */
export async function getLibraryStatus(userId: string, seriesId: string) {
  const entry = await repository.findEntry(userId, seriesId);
  if (entry === null) return null;
  return { status: entry.status, progressEpisodes: entry.progressEpisodes };
}

export async function saveLibraryEntry(userId: string, seriesId: string, input: LibraryUpsertBody) {
  if (!(await repository.seriesExists(seriesId))) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }
  const existing = await repository.findEntry(userId, seriesId);
  const row = await repository.saveEntry(userId, seriesId, existing?.id ?? null, {
    status: input.status,
    progressEpisodes: input.progressEpisodes ?? existing?.progressEpisodes ?? 0,
    rewatchCount: input.rewatchCount ?? existing?.rewatchCount ?? 0,
    notes: input.notes === undefined ? (existing?.notes ?? null) : input.notes,
    isPrivate: input.isPrivate ?? existing?.isPrivate ?? false,
    startedAt: input.status === 'watching' && existing?.startedAt == null ? now() : existing?.startedAt,
    finishedAt: input.status === 'completed' ? (existing?.finishedAt ?? now()) : null,
  });
  if (row === null) throw new Error('Library entry write returned no row.');
  return { row, created: existing === null };
}

export async function removeLibraryEntry(userId: string, seriesId: string) {
  await repository.removeEntry(userId, seriesId);
  return { success: true };
}

/**
 * Statuses that watching an episode should move away from automatically.
 *
 * `watching` is already there. `dropped` and `completed` are left alone: a
 * dropped title is a deliberate call the viewer made, and one rewatched
 * episode of a finished series is not evidence the whole thing un-finished
 * itself. Both still change on an explicit `PUT /library/:seriesId`.
 */
const AUTO_WATCHING_FROM = new Set<string>(['planned', 'paused']);

export async function saveProgress(userId: string, episodeId: string, input: ProgressUpsertBody) {
  const episode = await repository.findEpisode(episodeId);
  if (episode === null) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }
  const completed =
    input.isCompleted ??
    (input.durationSeconds != null &&
      input.durationSeconds > 0 &&
      input.positionSeconds / input.durationSeconds >= 0.9);
  const row = await repository.upsertProgress(userId, episode, input, completed, now());
  if (row === null) throw new Error('Progress upsert returned no row.');

  await ensureWatchingEntry(userId, episode.seriesId);

  return toProgress(row);
}

/**
 * Puts a series on the viewer's library as `watching` the moment they
 * actually watch an episode of it, rather than only when they click "Add
 * to list" themselves — a list nobody has to remember to update is the
 * point of the feature.
 */
async function ensureWatchingEntry(userId: string, seriesId: string): Promise<void> {
  const existing = await repository.findEntry(userId, seriesId);
  if (existing !== null && !AUTO_WATCHING_FROM.has(existing.status)) return;

  await repository.saveEntry(userId, seriesId, existing?.id ?? null, {
    status: 'watching',
    progressEpisodes: existing?.progressEpisodes ?? 0,
    rewatchCount: existing?.rewatchCount ?? 0,
    notes: existing?.notes ?? null,
    isPrivate: existing?.isPrivate ?? false,
    startedAt: existing?.startedAt ?? now(),
    finishedAt: null,
  });
}

export async function getProgress(userId: string, episodeId: string) {
  const row = await repository.findProgress(userId, episodeId);
  return row === null ? null : toProgress(row);
}

export async function listContinueWatching(userId: string) {
  return (await repository.listContinueWatching(userId, 24)).map(toContinueWatching);
}
