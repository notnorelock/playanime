import type {
  CommentCreateBody,
  CommentQuery,
  CommentUpdateBody,
  ReviewCreateBody,
} from '@playanime/contracts';
import { db, EngagementRepository } from '@playanime/database';
import { requireOwnerOrModerator, type AuthenticatedSession } from '@playanime/auth';
import { clampPageSize, ErrorCode, NotFoundError } from '@playanime/shared';
import { toComment } from './engagement.mapper.js';

const repository = new EngagementRepository(db());

async function requireAnime(animeId: string): Promise<void> {
  if (!(await repository.animeExists(animeId))) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }
}

/** Resolves the episode and the title it belongs to, or throws. */
async function requireEpisode(episodeId: string) {
  const episode = await repository.findEpisode(episodeId);
  if (episode === null) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }
  return episode;
}

function cursorDate(cursor: string | undefined): Date | null {
  if (cursor === undefined) return null;
  const parsed = new Date(cursor);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Builds a page of comments, resolving the viewer's likes in one query.
 *
 * Shared by the title and episode listings so both report `isLikedByViewer`
 * the same way, and neither can quietly drift into an N+1.
 */
async function toCommentPage(
  rows: readonly Awaited<ReturnType<EngagementRepository['listComments']>>[number][],
  limit: number,
  viewerId: string | null,
) {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const likedIds =
    viewerId === null
      ? new Set<string>()
      : await repository.likedCommentIds(
          pageRows.map((row) => row.id),
          viewerId,
        );

  return {
    items: pageRows.map((row) => toComment(row, viewerId, likedIds)),
    nextCursor: hasMore ? (pageRows.at(-1)?.createdAt.toISOString() ?? null) : null,
    hasMore,
  };
}

/* -------------------------------------------------------------------------- */
/* Title comments                                                              */
/* -------------------------------------------------------------------------- */

export async function listComments(
  animeId: string,
  query: CommentQuery,
  viewerId: string | null,
  reviewsOnly: boolean,
) {
  await requireAnime(animeId);
  const limit = clampPageSize(query.limit);
  const rows = await repository.listComments(animeId, reviewsOnly, limit, cursorDate(query.cursor));
  return toCommentPage(rows, limit, viewerId);
}

export async function createComment(userId: string, animeId: string, input: CommentCreateBody) {
  await requireAnime(animeId);
  const parent = input.parentId == null ? null : await repository.parent(animeId, input.parentId);
  if (input.parentId != null && parent === null) {
    throw new NotFoundError('Nie znaleziono komentarza nadrzędnego.');
  }
  return repository.createComment(userId, animeId, input, parent);
}

export async function createReview(userId: string, animeId: string, input: ReviewCreateBody) {
  await requireAnime(animeId);
  const row = await repository.createReview(userId, animeId, input);
  if (row === null) throw new Error('Review insert returned no row.');
  return row;
}

/* -------------------------------------------------------------------------- */
/* Episode comments                                                            */
/* -------------------------------------------------------------------------- */

export async function listEpisodeComments(
  episodeId: string,
  query: CommentQuery,
  viewerId: string | null,
) {
  await requireEpisode(episodeId);
  const limit = clampPageSize(query.limit);
  const rows = await repository.listEpisodeComments(episodeId, limit, cursorDate(query.cursor));
  return toCommentPage(rows, limit, viewerId);
}

export async function createEpisodeComment(
  userId: string,
  episodeId: string,
  input: CommentCreateBody,
) {
  const episode = await requireEpisode(episodeId);

  const parent =
    input.parentId == null ? null : await repository.episodeCommentParent(episodeId, input.parentId);

  if (input.parentId != null && parent === null) {
    throw new NotFoundError('Nie znaleziono komentarza nadrzędnego.');
  }

  return repository.createEpisodeComment(userId, episodeId, episode.animeId, input, parent);
}

/* -------------------------------------------------------------------------- */
/* Ownership and likes                                                         */
/* -------------------------------------------------------------------------- */

export async function getCommentOwner(commentId: string) {
  const row = await repository.commentOwner(commentId);
  if (row === null) throw new NotFoundError('Nie znaleziono komentarza.');
  return row.userId;
}

export async function updateOwnedComment(
  session: AuthenticatedSession,
  commentId: string,
  input: CommentUpdateBody,
) {
  requireOwnerOrModerator(session, await getCommentOwner(commentId));
  return repository.updateComment(commentId, input);
}

export async function removeOwnedComment(session: AuthenticatedSession, commentId: string) {
  requireOwnerOrModerator(session, await getCommentOwner(commentId));
  await repository.removeComment(commentId);
  return { success: true };
}

/**
 * Likes or unlikes a comment.
 *
 * One endpoint rather than a like/unlike pair: the client toggles, and the
 * server returns the resulting state, so a double-click cannot double-count and
 * the UI never has to guess the new total.
 */
export async function toggleCommentLike(userId: string, commentId: string) {
  // Confirms the comment exists and is not removed before writing a like for it.
  await getCommentOwner(commentId);

  const result = await repository.toggleCommentLike(commentId, userId);

  return {
    commentId,
    likeCount: result.likeCount,
    isLikedByViewer: result.liked,
  };
}
