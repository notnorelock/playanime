import type { RatingUpsertBody } from '@playanime/contracts';
import { db, EngagementRepository } from '@playanime/database';
import { ErrorCode, NotFoundError } from '@playanime/shared';
import { toRating } from './engagement.mapper.js';

const repository = new EngagementRepository(db());

async function requireAnime(animeId: string): Promise<void> {
  if (!(await repository.animeExists(animeId))) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }
}

export async function getRating(userId: string, animeId: string) {
  const row = await repository.rating(userId, animeId);
  return row === null ? null : toRating(row, animeId);
}

export async function saveRating(userId: string, animeId: string, input: RatingUpsertBody) {
  await requireAnime(animeId);
  const row = await repository.upsertRating(userId, animeId, input.score);
  if (row === null) throw new Error('Rating upsert returned no row.');
  await repository.refreshRatingAggregate(animeId);
  return toRating(row, animeId);
}

export async function removeRating(userId: string, animeId: string) {
  await repository.deleteRating(userId, animeId);
  await repository.refreshRatingAggregate(animeId);
  return { success: true };
}
