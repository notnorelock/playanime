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

export async function saveLibraryEntry(userId: string, animeId: string, input: LibraryUpsertBody) {
  if (!(await repository.animeExists(animeId))) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }
  const existing = await repository.findEntry(userId, animeId);
  const row = await repository.saveEntry(userId, animeId, existing?.id ?? null, {
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

export async function removeLibraryEntry(userId: string, animeId: string) {
  await repository.removeEntry(userId, animeId);
  return { success: true };
}

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
  return toProgress(row);
}

export async function getProgress(userId: string, episodeId: string) {
  const row = await repository.findProgress(userId, episodeId);
  return row === null ? null : toProgress(row);
}

export async function listContinueWatching(userId: string) {
  return (await repository.listContinueWatching(userId, 24)).map(toContinueWatching);
}
