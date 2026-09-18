/**
 * Domain enums shared by the database schema and the public API.
 *
 * These are declared here — not in `@playanime/database` — so that `contracts`
 * never has to import the database package to describe a response. The database
 * imports *these* when declaring its pgEnums, which keeps the dependency
 * pointing in the legal direction (tier 3 -> tier 1).
 */

/**
 * The kind of release one `Entry` is. Replaces the old flat `TitleFormat` —
 * a franchise is not a flat list of episodes: `Fate/stay night` has TV
 * series, films, OVAs, and specials that share characters and a franchise
 * but not a season ordering, and this is the per-release discriminator for
 * that structure (`Franchise -> Series -> Entry -> Episode`).
 */
export const EntryType = {
  TV: 'tv',
  TV_SHORT: 'tv_short',
  MOVIE: 'movie',
  OVA: 'ova',
  ONA: 'ona',
  SPECIAL: 'special',
  RECAP: 'recap',
  COMPILATION: 'compilation',
  MUSIC: 'music',
  WEB: 'web',
  OTHER: 'other',
} as const;
export type EntryType = (typeof EntryType)[keyof typeof EntryType];
export const ENTRY_TYPES = Object.values(EntryType);

/**
 * How two `Entry` rows relate to each other (e.g. "this OVA is Season 1's
 * sequel"). Directional: `EntryRelationDto` carries the direction the read
 * side resolved, not a column on this enum itself.
 */
export const EntryRelationType = {
  SEQUEL: 'sequel',
  PREQUEL: 'prequel',
  SIDE_STORY: 'side_story',
  SPIN_OFF: 'spin_off',
  ALTERNATIVE: 'alternative',
  SUMMARY: 'summary',
  PARENT_STORY: 'parent_story',
  OTHER: 'other',
} as const;
export type EntryRelationType = (typeof EntryRelationType)[keyof typeof EntryRelationType];
export const ENTRY_RELATION_TYPES = Object.values(EntryRelationType);

/**
 * Where a relation edge came from — AniList sync must never overwrite a
 * `manual` row (an admin's own curated correction), only ever touch rows it
 * created itself.
 */
export const EntryRelationSource = {
  ANILIST: 'anilist',
  MANUAL: 'manual',
} as const;
export type EntryRelationSource = (typeof EntryRelationSource)[keyof typeof EntryRelationSource];
export const ENTRY_RELATION_SOURCES = Object.values(EntryRelationSource);

/**
 * What one episode is, within its Entry. Distinct from `EntryType`: most
 * specials/OVAs/recaps are their own Entry, not an episode-type flag — this
 * exists for the rarer case a bonus/special episode is embedded inside an
 * otherwise-regular Entry's own numbering rather than warranting a whole
 * separate release.
 */
export const EpisodeType = {
  REGULAR: 'regular',
  SPECIAL: 'special',
  RECAP: 'recap',
  OVA: 'ova',
  ONA: 'ona',
  EXTRA: 'extra',
  OTHER: 'other',
} as const;
export type EpisodeType = (typeof EpisodeType)[keyof typeof EpisodeType];
export const EPISODE_TYPES = Object.values(EpisodeType);

export const ReleaseStatus = {
  NOT_YET_RELEASED: 'not_yet_released',
  RELEASING: 'releasing',
  FINISHED: 'finished',
  HIATUS: 'hiatus',
  CANCELLED: 'cancelled',
} as const;
export type ReleaseStatus = (typeof ReleaseStatus)[keyof typeof ReleaseStatus];
export const RELEASE_STATUSES = Object.values(ReleaseStatus);

/** Broadcast season. Combined with a year to identify a seasonal cour. */
export const SeasonOfYear = {
  WINTER: 'winter',
  SPRING: 'spring',
  SUMMER: 'summer',
  FALL: 'fall',
} as const;
export type SeasonOfYear = (typeof SeasonOfYear)[keyof typeof SeasonOfYear];
export const SEASONS_OF_YEAR = Object.values(SeasonOfYear);

/** Content rating, driving the "hide mature content" profile preference. */
export const AgeRating = {
  G: 'g',
  PG: 'pg',
  PG_13: 'pg_13',
  R_17: 'r_17',
  R_PLUS: 'r_plus',
  RX: 'rx',
} as const;
export type AgeRating = (typeof AgeRating)[keyof typeof AgeRating];
export const AGE_RATINGS = Object.values(AgeRating);

/** Kind of alternate title, so the UI can prefer the right one per locale. */
export const TitleKind = {
  ROMAJI: 'romaji',
  ENGLISH: 'english',
  NATIVE: 'native',
  SYNONYM: 'synonym',
} as const;
export type TitleKind = (typeof TitleKind)[keyof typeof TitleKind];
export const TITLE_KINDS = Object.values(TitleKind);

/** Role an organization played on a title. */
export const OrganizationRole = {
  STUDIO: 'studio',
  PRODUCER: 'producer',
  LICENSOR: 'licensor',
} as const;
export type OrganizationRole = (typeof OrganizationRole)[keyof typeof OrganizationRole];
export const ORGANIZATION_ROLES = Object.values(OrganizationRole);

/** Artwork kind. */
export const MediaAssetKind = {
  POSTER: 'poster',
  BANNER: 'banner',
  LOGO: 'logo',
  THUMBNAIL: 'thumbnail',
  TRAILER: 'trailer',
} as const;
export type MediaAssetKind = (typeof MediaAssetKind)[keyof typeof MediaAssetKind];
export const MEDIA_ASSET_KINDS = Object.values(MediaAssetKind);

/** Where a title sits in a user's library. */
export const WatchStatus = {
  WATCHING: 'watching',
  PLANNED: 'planned',
  COMPLETED: 'completed',
  PAUSED: 'paused',
  DROPPED: 'dropped',
} as const;
export type WatchStatus = (typeof WatchStatus)[keyof typeof WatchStatus];
export const WATCH_STATUSES = Object.values(WatchStatus);

/** Lightweight reaction, tracked independently of the 1-10 rating. */
export const ReactionKind = {
  LOVE: 'love',
  FIRE: 'fire',
  CRY: 'cry',
  LAUGH: 'laugh',
  SHOCK: 'shock',
  THINK: 'think',
} as const;
export type ReactionKind = (typeof ReactionKind)[keyof typeof ReactionKind];
export const REACTION_KINDS = Object.values(ReactionKind);

/**
 * Role inside a fansub group.
 *
 * Ranked: a leader may do anything an editor may, and so on down. Only
 * `leader` can change membership or group settings — the repository enforces
 * that at least one leader always remains, because a group without one can
 * never be administered again.
 */
export const TranslatorRole = {
  LEADER: 'leader',
  EDITOR: 'editor',
  TRANSLATOR: 'translator',
  TIMER: 'timer',
  TYPESETTER: 'typesetter',
  MEMBER: 'member',
} as const;
export type TranslatorRole = (typeof TranslatorRole)[keyof typeof TranslatorRole];
export const TRANSLATOR_ROLES = Object.values(TranslatorRole);

/** Ranked privileges within a group. Higher outranks lower. */
export const TRANSLATOR_ROLE_RANK: Readonly<Record<TranslatorRole, number>> = {
  [TranslatorRole.LEADER]: 100,
  [TranslatorRole.EDITOR]: 50,
  [TranslatorRole.TRANSLATOR]: 30,
  [TranslatorRole.TIMER]: 20,
  [TranslatorRole.TYPESETTER]: 20,
  [TranslatorRole.MEMBER]: 0,
};

export const hasAtLeastTranslatorRole = (
  actual: TranslatorRole,
  required: TranslatorRole,
): boolean => TRANSLATOR_ROLE_RANK[actual] >= TRANSLATOR_ROLE_RANK[required];

/** Lifecycle of a request to join a group. */
export const TranslatorApplicationStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
} as const;
export type TranslatorApplicationStatus =
  (typeof TranslatorApplicationStatus)[keyof typeof TranslatorApplicationStatus];
export const TRANSLATOR_APPLICATION_STATUSES = Object.values(TranslatorApplicationStatus);
