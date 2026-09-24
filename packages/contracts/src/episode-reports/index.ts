import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, literalUnion, Uuid } from '../common/index.js';

/**
 * Episode reports — "report episode" on the watch page: a logged-in user
 * flags a specific episode as broken (wrong video, no subtitles, dead
 * source, etc.), staff triage from the admin panel, and the reporter gets
 * an email with the outcome and any reply.
 *
 * A dedicated table, deliberately separate from the general `reports`
 * system (which already covers `episode_source`/`anime`/`comment`/`review`/
 * `user` targets with its own moderation queue): an episode report always
 * has exactly one target (the episode itself, not a specific source row,
 * since a viewer reporting "this doesn't play" usually can't tell which
 * underlying source is at fault), always has a real submitter to email
 * back, and its resolution is a one-shot reply + status rather than an
 * approve/reject action against a target row.
 */

export const EpisodeReportReason = {
  VIDEO_NOT_PLAYING: 'video_not_playing',
  WRONG_VIDEO: 'wrong_video',
  WRONG_SUBTITLES: 'wrong_subtitles',
  AUDIO_SYNC: 'audio_sync',
  POOR_QUALITY: 'poor_quality',
  OTHER: 'other',
} as const;
export type EpisodeReportReason = (typeof EpisodeReportReason)[keyof typeof EpisodeReportReason];
export const EPISODE_REPORT_REASONS = Object.values(EpisodeReportReason);

export const EpisodeReportStatus = {
  /** Not yet triaged by staff. */
  OPEN: 'open',
  /** Confirmed and fixed. */
  ACTION_TAKEN: 'action_taken',
  /** Reviewed, no issue found (or not actionable). */
  DISMISSED: 'dismissed',
} as const;
export type EpisodeReportStatus = (typeof EpisodeReportStatus)[keyof typeof EpisodeReportStatus];
export const EPISODE_REPORT_STATUSES = Object.values(EpisodeReportStatus);

export const EpisodeReportCreateBody = Type.Object({
  episodeId: Uuid,
  reason: literalUnion(EPISODE_REPORT_REASONS),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type EpisodeReportCreateBody = Static<typeof EpisodeReportCreateBody>;

export const EpisodeReportCreateResponse = Type.Object({
  id: Uuid,
  message: Type.String(),
});
export type EpisodeReportCreateResponse = Static<typeof EpisodeReportCreateResponse>;

/** The staff queue's row shape — one report, with enough episode/anime context to triage without a second lookup. */
export const EpisodeReportDto = Type.Object({
  id: Uuid,
  episodeId: Uuid,
  animeTitle: Type.String(),
  episodeNumber: Type.Integer(),
  reason: literalUnion(EPISODE_REPORT_REASONS),
  description: Type.Union([Type.String(), Type.Null()]),
  status: literalUnion(EPISODE_REPORT_STATUSES),
  reporterUsername: Type.String(),
  replyText: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type EpisodeReportDto = Static<typeof EpisodeReportDto>;

export const EpisodeReportResolveBody = Type.Object({
  status: literalUnion([EpisodeReportStatus.ACTION_TAKEN, EpisodeReportStatus.DISMISSED]),
  /** Shown to the reporter, in the resolution email. Optional — a status alone is a valid resolution. */
  replyText: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type EpisodeReportResolveBody = Static<typeof EpisodeReportResolveBody>;

export const EpisodeReportQuery = Type.Object({
  status: Type.Optional(literalUnion(EPISODE_REPORT_STATUSES)),
  limit: Type.Optional(
    Type.Union([Type.Integer({ minimum: 1, maximum: 200 }), Type.String({ pattern: '^[1-9][0-9]{0,2}$' })]),
  ),
});
export type EpisodeReportQuery = Static<typeof EpisodeReportQuery>;
