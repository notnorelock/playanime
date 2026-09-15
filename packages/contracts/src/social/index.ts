import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, IsoDateTime, literalUnion, Uuid } from '../common/index.js';

export const PublicProfile = Type.Object({
  userId: Uuid,
  username: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  bio: Type.Union([Type.String(), Type.Null()]),
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

export const ActivityItem = Type.Object({
  id: Uuid,
  kind: literalUnion(ACTIVITY_KINDS),
  animeId: Type.Union([Uuid, Type.Null()]),
  summary: Type.String(),
  occurredAt: IsoDateTime,
});
export type ActivityItem = Static<typeof ActivityItem>;

export const ActivityQuery = CursorQuery;
export type ActivityQuery = Static<typeof ActivityQuery>;
export const ActivityPage = CursorPageOf(ActivityItem);
export type ActivityPage = Static<typeof ActivityPage>;

export const FollowListQuery = CursorQuery;
export type FollowListQuery = Static<typeof FollowListQuery>;
export const ProfilePage = CursorPageOf(PublicProfile);
export type ProfilePage = Static<typeof ProfilePage>;
