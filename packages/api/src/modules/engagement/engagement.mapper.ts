import type { EngagementRepository } from '@playanime/database';

type RatingRow = NonNullable<Awaited<ReturnType<EngagementRepository['rating']>>>;
type CommentRow = Awaited<ReturnType<EngagementRepository['listComments']>>[number];

export function toRating(row: RatingRow, animeId: string) {
  return {
    id: row.id,
    animeId,
    score: row.score,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toComment(row: CommentRow, viewerId: string | null) {
  return {
    id: row.id,
    animeId: row.animeId,
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
    canEdit: viewerId === row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
