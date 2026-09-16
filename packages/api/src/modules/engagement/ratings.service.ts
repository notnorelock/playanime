import type {
  EpisodeRatingSummary,
  RatingUpsertBody,
  ReactionKind,
} from '@playanime/contracts';
import { db, EngagementRepository } from '@playanime/database';
import { ErrorCode, NotFoundError } from '@playanime/shared';
import { toRating } from './engagement.mapper.js';

const repository = new EngagementRepository(db());

async function requireAnime(animeId: string): Promise<void> {
  if (!(await repository.animeExists(animeId))) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }
}

async function requireEpisode(episodeId: string): Promise<void> {
  if ((await repository.findEpisode(episodeId)) === null) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Title ratings                                                               */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Episode ratings and reactions                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything the episode rating widget renders, in one response.
 *
 * Aggregate, the viewer's own score and the reaction tallies are independent
 * reads, so they are issued together rather than in sequence. Anonymous viewers
 * skip the two that need an identity.
 */
export async function getEpisodeRatingSummary(
  episodeId: string,
  viewerId: string | null,
): Promise<EpisodeRatingSummary> {
  await requireEpisode(episodeId);

  const [aggregate, viewerRating, reactionCounts, viewerReactions] = await Promise.all([
    repository.episodeRatingAggregate(episodeId),
    viewerId === null ? null : repository.episodeRating(viewerId, episodeId),
    repository.episodeReactionCounts(episodeId),
    viewerId === null ? [] : repository.viewerEpisodeReactions(viewerId, episodeId),
  ]);

  // Only kinds somebody actually used appear: a zero for every possible
  // reaction would be noise, and the UI can render an absent key as none.
  const reactions: Record<string, number> = {};
  for (const row of reactionCounts) reactions[row.kind] = row.total;

  return {
    episodeId,
    averageScore: aggregate.average,
    ratingCount: aggregate.count,
    viewerScore: viewerRating?.score ?? null,
    reactions,
    viewerReactions: viewerReactions.map((row) => row.kind),
  };
}

export async function saveEpisodeRating(
  userId: string,
  episodeId: string,
  input: RatingUpsertBody,
) {
  await requireEpisode(episodeId);

  const row = await repository.upsertEpisodeRating(userId, episodeId, input.score);
  if (row === null) throw new Error('Episode rating upsert returned no row.');

  // The summary is returned rather than the bare row: the caller almost always
  // needs the new average, and this saves it a follow-up request.
  return getEpisodeRatingSummary(episodeId, userId);
}

export async function removeEpisodeRating(userId: string, episodeId: string) {
  await requireEpisode(episodeId);
  await repository.deleteEpisodeRating(userId, episodeId);
  return getEpisodeRatingSummary(episodeId, userId);
}

/** Adds the reaction, or removes it when the viewer already left it. */
export async function toggleEpisodeReaction(
  userId: string,
  episodeId: string,
  kind: ReactionKind,
) {
  await requireEpisode(episodeId);
  await repository.toggleEpisodeReaction(userId, episodeId, kind);
  return getEpisodeRatingSummary(episodeId, userId);
}
