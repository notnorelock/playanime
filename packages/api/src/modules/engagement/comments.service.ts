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

export async function listComments(
  animeId: string,
  query: CommentQuery,
  viewerId: string | null,
  reviewsOnly: boolean,
) {
  await requireAnime(animeId);
  const limit = clampPageSize(query.limit);
  const parsed = query.cursor === undefined ? null : new Date(query.cursor);
  const before = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const rows = await repository.listComments(animeId, reviewsOnly, limit, before);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map((row) => toComment(row, viewerId)),
    nextCursor: hasMore ? (pageRows.at(-1)?.createdAt.toISOString() ?? null) : null,
    hasMore,
  };
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
