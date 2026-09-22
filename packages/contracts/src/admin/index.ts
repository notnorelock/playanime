import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, IsoDateTime, literalUnion, Slug, Uuid } from '../common/index.js';
import { USER_ROLES } from '../auth/index.js';
import { ENTRY_TYPES, RELEASE_STATUSES } from '../anime/enums.js';

/**
 * Staff-only administration.
 *
 * Every schema here is reachable only behind a role guard. They expose data an
 * ordinary user must never see — email addresses, sanction history, moderation
 * counts — so nothing in this file may be reused in a public response.
 */

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A user as the admin list shows them.
 *
 * Contains the email address, which is why this DTO exists separately from
 * `PublicProfile` rather than extending it: the difference between the two must
 * be a deliberate import, not an accident of inheritance.
 */
export const AdminUserDto = Type.Object({
  id: Uuid,
  email: Type.String({ format: 'email' }),
  username: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  role: literalUnion(USER_ROLES),
  emailVerified: Type.Boolean(),
  /** Set while a suspension is in force. Null for an account in good standing. */
  suspendedAt: Type.Union([IsoDateTime, Type.Null()]),
  suspendedUntil: Type.Union([IsoDateTime, Type.Null()]),
  suspensionReason: Type.Union([Type.String(), Type.Null()]),
  lastLoginAt: Type.Union([IsoDateTime, Type.Null()]),
  createdAt: IsoDateTime,
});
export type AdminUserDto = Static<typeof AdminUserDto>;

export const AdminUserPage = CursorPageOf(AdminUserDto);
export type AdminUserPage = Static<typeof AdminUserPage>;

export const AdminUserQuery = Type.Object({
  ...CursorQuery.properties,
  /** Matches username or email. */
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 254 })),
  role: Type.Optional(literalUnion(USER_ROLES)),
  suspendedOnly: Type.Optional(
    Type.Union([Type.Boolean(), Type.Literal('true'), Type.Literal('false')]),
  ),
});
export type AdminUserQuery = Static<typeof AdminUserQuery>;

/**
 * Role change.
 *
 * A reason is mandatory: this is the single most consequential action in the
 * product, and an audit row without one is useless six months later.
 */
export const AdminRoleUpdateBody = Type.Object({
  role: literalUnion(USER_ROLES),
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
});
export type AdminRoleUpdateBody = Static<typeof AdminRoleUpdateBody>;

export const AdminSanctionBody = Type.Object({
  kind: Type.Union([
    Type.Literal('warning'),
    Type.Literal('mute'),
    Type.Literal('suspension'),
    Type.Literal('ban'),
  ]),
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
  /**
   * Duration. Omitted means permanent, which for `suspension` and `ban` is a
   * deliberate choice the moderator must make rather than a default.
   */
  durationDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
});
export type AdminSanctionBody = Static<typeof AdminSanctionBody>;

export const AdminSanctionDto = Type.Object({
  id: Uuid,
  userId: Uuid,
  kind: Type.String(),
  reason: Type.String(),
  expiresAt: Type.Union([IsoDateTime, Type.Null()]),
  issuedByUsername: Type.Union([Type.String(), Type.Null()]),
  liftedAt: Type.Union([IsoDateTime, Type.Null()]),
  liftedByUsername: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type AdminSanctionDto = Static<typeof AdminSanctionDto>;

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A series as the admin catalogue shows it, including hidden and adult
 * rows. `format`/`seasonYear`/`episodeCount` are read from the series'
 * default (main) entry — a series with no entries yet shows nulls there.
 */
export const AdminSeriesDto = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
  format: Type.Union([literalUnion(ENTRY_TYPES), Type.Null()]),
  status: Type.Union([literalUnion(RELEASE_STATUSES), Type.Null()]),
  seasonYear: Type.Union([Type.Integer(), Type.Null()]),
  episodeCount: Type.Union([Type.Integer(), Type.Null()]),
  entryCount: Type.Integer({ minimum: 0 }),
  /** Real episode rows across every entry, which may differ from the declared count. */
  actualEpisodeCount: Type.Integer({ minimum: 0 }),
  sourceCount: Type.Integer({ minimum: 0 }),
  isAdult: Type.Boolean(),
  /** Set when soft-deleted. Such rows are invisible to the public API. */
  deletedAt: Type.Union([IsoDateTime, Type.Null()]),
  updatedAt: IsoDateTime,
});
export type AdminSeriesDto = Static<typeof AdminSeriesDto>;

export const AdminSeriesPage = CursorPageOf(AdminSeriesDto);
export type AdminSeriesPage = Static<typeof AdminSeriesPage>;

export const AdminSeriesQuery = Type.Object({
  ...CursorQuery.properties,
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  includeDeleted: Type.Optional(
    Type.Union([Type.Boolean(), Type.Literal('true'), Type.Literal('false')]),
  ),
  /** Filters to the main entry's release status — "airing"/"planned"/"finished"/"cancelled" breakdown for the admin catalogue list. */
  status: Type.Optional(literalUnion(RELEASE_STATUSES)),
});
export type AdminSeriesQuery = Static<typeof AdminSeriesQuery>;

export const AdminSeriesUpdateBody = Type.Partial(
  Type.Object({
    synopsis: Type.Union([Type.String({ maxLength: 10000 }), Type.Null()]),
  }),
);
export type AdminSeriesUpdateBody = Static<typeof AdminSeriesUpdateBody>;

/** Edits to the series' default (main) entry — status/episodeCount/isAdult live here, not on the series row. */
export const AdminEntryUpdateBody = Type.Partial(
  Type.Object({
    status: literalUnion(RELEASE_STATUSES),
    episodeCount: Type.Union([Type.Integer({ minimum: 0, maximum: 10000 }), Type.Null()]),
    isAdult: Type.Boolean(),
    synopsis: Type.Union([Type.String({ maxLength: 10000 }), Type.Null()]),
  }),
);
export type AdminEntryUpdateBody = Static<typeof AdminEntryUpdateBody>;

/* -------------------------------------------------------------------------- */
/* Comment moderation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A comment in the moderation queue.
 *
 * Carries the author and the open report count, which is what a moderator
 * triages on. The body is plain text, exactly as stored — it is never rendered
 * as markup anywhere in PlayAnime.
 */
export const AdminCommentDto = Type.Object({
  id: Uuid,
  body: Type.String(),
  seriesId: Type.Union([Uuid, Type.Null()]),
  seriesTitle: Type.Union([Type.String(), Type.Null()]),
  episodeId: Type.Union([Uuid, Type.Null()]),
  authorUserId: Uuid,
  authorUsername: Type.String(),
  rating: Type.Union([Type.Integer(), Type.Null()]),
  hasSpoilers: Type.Boolean(),
  likeCount: Type.Integer({ minimum: 0 }),
  replyCount: Type.Integer({ minimum: 0 }),
  openReportCount: Type.Integer({ minimum: 0 }),
  removedAt: Type.Union([IsoDateTime, Type.Null()]),
  removalReason: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type AdminCommentDto = Static<typeof AdminCommentDto>;

export const AdminCommentPage = CursorPageOf(AdminCommentDto);
export type AdminCommentPage = Static<typeof AdminCommentPage>;

export const AdminCommentQuery = Type.Object({
  ...CursorQuery.properties,
  /** `reported` is the triage queue; `removed` reviews past decisions. */
  filter: Type.Optional(
    Type.Union([Type.Literal('all'), Type.Literal('reported'), Type.Literal('removed')]),
  ),
  search: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});
export type AdminCommentQuery = Static<typeof AdminCommentQuery>;

/* -------------------------------------------------------------------------- */
/* Analytics                                                                   */
/* -------------------------------------------------------------------------- */

/** One point on a daily series. */
export const AdminTimeseriesPoint = Type.Object({
  date: Type.String({ format: 'date' }),
  value: Type.Integer({ minimum: 0 }),
});
export type AdminTimeseriesPoint = Static<typeof AdminTimeseriesPoint>;

/**
 * Platform overview.
 *
 * Every figure here is a real count computed from a table. Nothing is estimated
 * and nothing is a placeholder — a dashboard that displays invented numbers is
 * worse than one that displays none.
 */
export const AdminOverviewDto = Type.Object({
  users: Type.Object({
    total: Type.Integer({ minimum: 0 }),
    newLast7Days: Type.Integer({ minimum: 0 }),
    newLast30Days: Type.Integer({ minimum: 0 }),
    suspended: Type.Integer({ minimum: 0 }),
  }),
  catalogue: Type.Object({
    anime: Type.Integer({ minimum: 0 }),
    episodes: Type.Integer({ minimum: 0 }),
    sources: Type.Integer({ minimum: 0 }),
  }),
  moderation: Type.Object({
    pendingSources: Type.Integer({ minimum: 0 }),
    openReports: Type.Integer({ minimum: 0 }),
    removedComments: Type.Integer({ minimum: 0 }),
  }),
  engagement: Type.Object({
    comments: Type.Integer({ minimum: 0 }),
    ratings: Type.Integer({ minimum: 0 }),
    libraryEntries: Type.Integer({ minimum: 0 }),
  }),
  translators: Type.Object({
    groups: Type.Integer({ minimum: 0 }),
    pendingApplications: Type.Integer({ minimum: 0 }),
  }),
  generatedAt: IsoDateTime,
});
export type AdminOverviewDto = Static<typeof AdminOverviewDto>;

export const AdminAnalyticsQuery = Type.Object({
  /** Window length. Capped so an unbounded scan cannot be requested. */
  days: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1, maximum: 365 }), Type.String({ pattern: '^[0-9]{1,3}$' })]),
  ),
});
export type AdminAnalyticsQuery = Static<typeof AdminAnalyticsQuery>;

export const AdminAnalyticsDto = Type.Object({
  registrations: Type.Array(AdminTimeseriesPoint),
  comments: Type.Array(AdminTimeseriesPoint),
  sourceSubmissions: Type.Array(AdminTimeseriesPoint),
  topAnime: Type.Array(
    Type.Object({
      seriesId: Uuid,
      slug: Slug,
      title: Type.String(),
      libraryCount: Type.Integer({ minimum: 0 }),
      averageRating: Type.Union([Type.Number(), Type.Null()]),
    }),
  ),
  from: Type.String({ format: 'date' }),
  to: Type.String({ format: 'date' }),
});
export type AdminAnalyticsDto = Static<typeof AdminAnalyticsDto>;

/* -------------------------------------------------------------------------- */
/* Translator administration                                                   */
/* -------------------------------------------------------------------------- */

export const AdminTranslatorActionBody = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 1000 }),
});
export type AdminTranslatorActionBody = Static<typeof AdminTranslatorActionBody>;
