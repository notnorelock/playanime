import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, IsoDateTime, Uuid } from '../common/index.js';

export const Rating = Type.Object({
  id: Uuid,
  animeId: Uuid,
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
  animeId: Type.Union([Uuid, Type.Null()]),
  episodeId: Type.Union([Uuid, Type.Null()]),
  parentId: Type.Union([Uuid, Type.Null()]),
  author: CommentAuthor,
  body: Type.String(),
  rating: Type.Union([Type.Integer({ minimum: 1, maximum: 10 }), Type.Null()]),
  hasSpoilers: Type.Boolean(),
  likeCount: Type.Integer({ minimum: 0 }),
  replyCount: Type.Integer({ minimum: 0 }),
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
