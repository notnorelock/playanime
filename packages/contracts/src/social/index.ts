import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, IsoDateTime, literalUnion, Slug, Uuid } from '../common/index.js';
import { WATCH_STATUSES } from '../anime/index.js';

export const PublicProfile = Type.Object({
  userId: Uuid,
  username: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  bio: Type.Union([Type.String(), Type.Null()]),
  /** Free text, e.g. "she/her" — not a fixed set, so it is never validated against one. */
  pronouns: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  banner: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  followerCount: Type.Integer({ minimum: 0 }),
  followingCount: Type.Integer({ minimum: 0 }),
  completedCount: Type.Integer({ minimum: 0 }),
  isFollowedByViewer: Type.Boolean(),
  createdAt: IsoDateTime,
});
export type PublicProfile = Static<typeof PublicProfile>;

export const ProfileUpdateBody = Type.Object({
  displayName: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  bio: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  pronouns: Type.Optional(Type.Union([Type.String({ maxLength: 30 }), Type.Null()])),
  avatar: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  banner: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
});
export type ProfileUpdateBody = Static<typeof ProfileUpdateBody>;

export const ActivityKind = {
  LIBRARY: 'library',
  RATING: 'rating',
  COMMENT: 'comment',
} as const;
export const ACTIVITY_KINDS = Object.values(ActivityKind);

/**
 * One feed entry per kind, as a discriminated union rather than one shape
 * with a loose `summary` string. A `${title}: ${status}` string baked in
 * server-side cannot be localized or styled per-kind on the client and, since
 * it carried no slug, could not even link to the title without a second
 * lookup — every field the client needs to render and link the entry itself
 * is here instead.
 */
const ActivityItemBase = Type.Object({
  id: Uuid,
  animeId: Uuid,
  animeSlug: Slug,
  animeTitle: Type.String(),
  occurredAt: IsoDateTime,
});

export const LibraryActivityItem = Type.Object({
  ...ActivityItemBase.properties,
  kind: Type.Literal(ActivityKind.LIBRARY),
  status: literalUnion(WATCH_STATUSES),
});

export const RatingActivityItem = Type.Object({
  ...ActivityItemBase.properties,
  kind: Type.Literal(ActivityKind.RATING),
  score: Type.Integer({ minimum: 1, maximum: 10 }),
});

export const CommentActivityItem = Type.Object({
  ...ActivityItemBase.properties,
  kind: Type.Literal(ActivityKind.COMMENT),
});

export const ActivityItem = Type.Union([LibraryActivityItem, RatingActivityItem, CommentActivityItem]);
export type ActivityItem = Static<typeof ActivityItem>;

export const ActivityQuery = CursorQuery;
export type ActivityQuery = Static<typeof ActivityQuery>;
export const ActivityPage = CursorPageOf(ActivityItem);
export type ActivityPage = Static<typeof ActivityPage>;

export const FollowListQuery = CursorQuery;
export type FollowListQuery = Static<typeof FollowListQuery>;
export const ProfilePage = CursorPageOf(PublicProfile);
export type ProfilePage = Static<typeof ProfilePage>;
