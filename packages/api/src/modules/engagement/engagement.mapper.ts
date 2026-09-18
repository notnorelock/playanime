import type { EngagementRepository } from '@playanime/database';

type RatingRow = NonNullable<Awaited<ReturnType<EngagementRepository['rating']>>>;
type CommentRow = Awaited<ReturnType<EngagementRepository['listComments']>>[number];
type EpisodeCommentRow = Awaited<ReturnType<EngagementRepository['listEpisodeComments']>>[number];

export function toRating(row: RatingRow, seriesId: string) {
  return {
    id: row.id,
    seriesId,
    score: row.score,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Comment row to DTO.
 *
 * `likedIds` is resolved once for the whole page rather than per comment: asking
 * "has the viewer liked this?" one comment at a time turns a twenty-comment
 * thread into twenty queries.
 */
export function toComment(
  row: CommentRow | EpisodeCommentRow,
  viewerId: string | null,
  likedIds: ReadonlySet<string> = new Set(),
) {
  return {
    id: row.id,
    seriesId: row.seriesId,
    episodeId: row.episodeId,
    parentId: row.parentId,
    author: {
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatar: row.avatar,
    },
    body: row.body,
    rating: row.rating,
    hasSpoilers: row.hasSpoilers,
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    // An anonymous viewer has liked nothing, so the set is empty and this is
    // false without a special case.
    isLikedByViewer: likedIds.has(row.id),
    canEdit: viewerId === row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
