import { Type, type Static } from '@sinclair/typebox';
import {
  CursorPageOf,
  CursorQuery,
  ImageRef,
  IsoDateTime,
  literalUnion,
  Slug,
  Uuid,
} from '../common/index.js';
import {
  TRANSLATOR_APPLICATION_STATUSES,
  TRANSLATOR_ROLES,
} from '../anime/enums.js';
import { AnimeSummary } from '../anime/index.js';

/**
 * Fansub groups.
 *
 * A group is the credited author of the translation work behind a source.
 * PlayAnime hosts no video, so the group page exists to attribute that work and
 * to let a group manage its own roster — not to give the platform control over
 * it.
 */

/** A member as the public group page shows them. */
export const TranslatorMemberDto = Type.Object({
  userId: Uuid,
  username: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  role: literalUnion(TRANSLATOR_ROLES),
  creditNote: Type.Union([Type.String(), Type.Null()]),
  joinedAt: IsoDateTime,
});
export type TranslatorMemberDto = Static<typeof TranslatorMemberDto>;

/** Directory card. Small on purpose: the listing renders many of these. */
export const TranslatorGroupSummary = Type.Object({
  id: Uuid,
  slug: Slug,
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([ImageRef, Type.Null()]),
  isVerified: Type.Boolean(),
  isRecruiting: Type.Boolean(),
  memberCount: Type.Integer({ minimum: 0 }),
  animeCount: Type.Integer({ minimum: 0 }),
  createdAt: IsoDateTime,
});
export type TranslatorGroupSummary = Static<typeof TranslatorGroupSummary>;

/** Title a group has claimed, with the scope it stated. */
export const TranslatorAnimeDto = Type.Object({
  anime: AnimeSummary,
  /** The group's own words, e.g. "1-12". Unverified by the platform. */
  episodeRange: Type.Union([Type.String(), Type.Null()]),
  note: Type.Union([Type.String(), Type.Null()]),
  addedAt: IsoDateTime,
});
export type TranslatorAnimeDto = Static<typeof TranslatorAnimeDto>;

export const TranslatorGroupDetail = Type.Object({
  ...TranslatorGroupSummary.properties,
  banner: Type.Union([ImageRef, Type.Null()]),
  websiteUrl: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  discordUrl: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  members: Type.Array(TranslatorMemberDto),
  titles: Type.Array(TranslatorAnimeDto),
  /**
   * The requesting user's role in this group, or null when they are not a
   * member. Lets the UI decide what to render without a second request, and
   * without guessing from the member list.
   */
  viewerRole: Type.Union([literalUnion(TRANSLATOR_ROLES), Type.Null()]),
  /** True when the viewer has an undecided application. */
  viewerHasPendingApplication: Type.Boolean(),
  updatedAt: IsoDateTime,
});
export type TranslatorGroupDetail = Static<typeof TranslatorGroupDetail>;

export const TranslatorGroupPage = CursorPageOf(TranslatorGroupSummary);
export type TranslatorGroupPage = Static<typeof TranslatorGroupPage>;

export const TranslatorGroupQuery = Type.Object({
  ...CursorQuery.properties,
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  recruitingOnly: Type.Optional(
    Type.Union([Type.Boolean(), Type.Literal('true'), Type.Literal('false')]),
  ),
  verifiedOnly: Type.Optional(
    Type.Union([Type.Boolean(), Type.Literal('true'), Type.Literal('false')]),
  ),
});
export type TranslatorGroupQuery = Static<typeof TranslatorGroupQuery>;

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Group creation.
 *
 * The slug is derived server-side from the name: letting a client choose one
 * invites squatting on the slugs of well-known groups.
 */
export const TranslatorGroupCreateBody = Type.Object({
  name: Type.String({ minLength: 2, maxLength: 100 }),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  avatarUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  bannerUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  websiteUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  discordUrl: Type.Optional(Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()])),
  isRecruiting: Type.Optional(Type.Boolean()),
});
export type TranslatorGroupCreateBody = Static<typeof TranslatorGroupCreateBody>;

/**
 * Group settings.
 *
 * Deliberately omits `name` and `slug`: renaming a group breaks every link to
 * it and is how impersonation happens, so it is a moderator action rather than
 * a self-service one.
 */
export const TranslatorGroupUpdateBody = Type.Partial(
  Type.Object({
    description: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    avatarUrl: Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()]),
    bannerUrl: Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()]),
    websiteUrl: Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()]),
    discordUrl: Type.Union([Type.String({ format: 'uri', maxLength: 2048 }), Type.Null()]),
    isRecruiting: Type.Boolean(),
  }),
);
export type TranslatorGroupUpdateBody = Static<typeof TranslatorGroupUpdateBody>;

export const TranslatorMemberUpsertBody = Type.Object({
  role: literalUnion(TRANSLATOR_ROLES),
  creditNote: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
});
export type TranslatorMemberUpsertBody = Static<typeof TranslatorMemberUpsertBody>;

/** Inviting by username rather than id: a leader knows the name, not the uuid. */
export const TranslatorMemberInviteBody = Type.Object({
  username: Type.String({ minLength: 3, maxLength: 32 }),
  role: Type.Optional(literalUnion(TRANSLATOR_ROLES)),
  creditNote: Type.Optional(Type.Union([Type.String({ maxLength: 200 }), Type.Null()])),
});
export type TranslatorMemberInviteBody = Static<typeof TranslatorMemberInviteBody>;

export const TranslatorAnimeUpsertBody = Type.Object({
  animeId: Uuid,
  episodeRange: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  note: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
});
export type TranslatorAnimeUpsertBody = Static<typeof TranslatorAnimeUpsertBody>;

/* -------------------------------------------------------------------------- */
/* Applications                                                                */
/* -------------------------------------------------------------------------- */

export const TranslatorApplicationDto = Type.Object({
  id: Uuid,
  groupId: Uuid,
  groupName: Type.String(),
  groupSlug: Slug,
  userId: Uuid,
  username: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
  status: literalUnion(TRANSLATOR_APPLICATION_STATUSES),
  decidedAt: Type.Union([IsoDateTime, Type.Null()]),
  createdAt: IsoDateTime,
});
export type TranslatorApplicationDto = Static<typeof TranslatorApplicationDto>;

export const TranslatorApplicationPage = CursorPageOf(TranslatorApplicationDto);
export type TranslatorApplicationPage = Static<typeof TranslatorApplicationPage>;

export const TranslatorApplicationCreateBody = Type.Object({
  message: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
});
export type TranslatorApplicationCreateBody = Static<typeof TranslatorApplicationCreateBody>;

export const TranslatorApplicationDecisionBody = Type.Object({
  accept: Type.Boolean(),
  /** Role granted on acceptance. Ignored when rejecting. */
  role: Type.Optional(literalUnion(TRANSLATOR_ROLES)),
});
export type TranslatorApplicationDecisionBody = Static<typeof TranslatorApplicationDecisionBody>;

export const TranslatorSlugParams = Type.Object({ slug: Slug });
export type TranslatorSlugParams = Static<typeof TranslatorSlugParams>;
