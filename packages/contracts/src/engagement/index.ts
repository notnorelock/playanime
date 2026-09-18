import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, IsoDateTime, Uuid, literalUnion } from '../common/index.js';
import { REACTION_KINDS } from '../anime/enums.js';

export const Rating = Type.Object({
  id: Uuid,
  seriesId: Uuid,
  score: Type.Integer({ minimum: 1, maximum: 10 }),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Rating = Static<typeof Rating>;

export const RatingUpsertBody = Type.Object({
  score: Type.Integer({ minimum: 1, maximum: 10 }),
});
export type RatingUpsertBody = Static<typeof RatingUpsertBody>;

export const CommentAuthor = Type.Object({
  userId: Uuid,
  username: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
});
export type CommentAuthor = Static<typeof CommentAuthor>;

export const Comment = Type.Object({
  id: Uuid,
  seriesId: Type.Union([Uuid, Type.Null()]),
  episodeId: Type.Union([Uuid, Type.Null()]),
  parentId: Type.Union([Uuid, Type.Null()]),
  author: CommentAuthor,
  body: Type.String(),
  rating: Type.Union([Type.Integer({ minimum: 1, maximum: 10 }), Type.Null()]),
  hasSpoilers: Type.Boolean(),
  likeCount: Type.Integer({ minimum: 0 }),
  replyCount: Type.Integer({ minimum: 0 }),
  /** Whether the requesting user has liked this comment. False when anonymous. */
  isLikedByViewer: Type.Boolean(),
  canEdit: Type.Boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Comment = Static<typeof Comment>;

export const CommentCreateBody = Type.Object({
  body: Type.String({ minLength: 1, maxLength: 10000 }),
  parentId: Type.Optional(Type.Union([Uuid, Type.Null()])),
  hasSpoilers: Type.Optional(Type.Boolean()),
});
export type CommentCreateBody = Static<typeof CommentCreateBody>;

export const ReviewCreateBody = Type.Object({
  body: Type.String({ minLength: 1, maxLength: 10000 }),
  rating: Type.Integer({ minimum: 1, maximum: 10 }),
  hasSpoilers: Type.Optional(Type.Boolean()),
});
export type ReviewCreateBody = Static<typeof ReviewCreateBody>;

export const CommentUpdateBody = Type.Object({
  body: Type.Optional(Type.String({ minLength: 1, maxLength: 10000 })),
  hasSpoilers: Type.Optional(Type.Boolean()),
});
export type CommentUpdateBody = Static<typeof CommentUpdateBody>;

export const CommentQuery = CursorQuery;
export type CommentQuery = Static<typeof CommentQuery>;
export const CommentPage = CursorPageOf(Comment);
export type CommentPage = Static<typeof CommentPage>;


/* -------------------------------------------------------------------------- */
/* Comment likes                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Result of liking or unliking.
 *
 * Returns the authoritative count rather than a bare success flag: the client
 * would otherwise have to guess the new total, and two viewers liking at once
 * would leave both showing the wrong number.
 */
export const CommentLikeResponse = Type.Object({
  commentId: Uuid,
  likeCount: Type.Integer({ minimum: 0 }),
  isLikedByViewer: Type.Boolean(),
});
export type CommentLikeResponse = Static<typeof CommentLikeResponse>;

/* -------------------------------------------------------------------------- */
/* Episode engagement                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Aggregate rating for one episode.
 *
 * Computed on read from the `ratings` rows. Episode ratings are far less
 * numerous than title ratings, so there is no denormalized counter to keep in
 * sync — and an aggregate that can never drift is worth more than the query it
 * saves.
 */
export const EpisodeRatingSummary = Type.Object({
  episodeId: Uuid,
  averageScore: Type.Union([Type.Number({ minimum: 0, maximum: 10 }), Type.Null()]),
  ratingCount: Type.Integer({ minimum: 0 }),
  /** The requesting user's own score, or null when unrated or anonymous. */
  viewerScore: Type.Union([Type.Integer({ minimum: 1, maximum: 10 }), Type.Null()]),
  /** Counts per reaction kind, omitting kinds nobody has used. */
  reactions: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  /** Reactions the requesting user has left. */
  viewerReactions: Type.Array(literalUnion(REACTION_KINDS)),
});
export type EpisodeRatingSummary = Static<typeof EpisodeRatingSummary>;

export const ReactionToggleBody = Type.Object({
  kind: literalUnion(REACTION_KINDS),
});
export type ReactionToggleBody = Static<typeof ReactionToggleBody>;
