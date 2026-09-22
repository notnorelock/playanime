import { Type, type Static } from '@sinclair/typebox';
import { ImageRef, IsoDateTime, Slug, Uuid, literalUnion } from '../common/index.js';
import { ENTRY_TYPES, RELEASE_STATUSES } from './enums.js';
import { EpisodeSourceListResponse } from '../media/sources.js';

export const EpisodeProgress = Type.Object({
  positionSeconds: Type.Integer({ minimum: 0 }),
  durationSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  isCompleted: Type.Boolean(),
  lastWatchedAt: IsoDateTime,
});
export type EpisodeProgress = Static<typeof EpisodeProgress>;

export const EpisodeSummary = Type.Object({
  id: Uuid,
  entryId: Uuid,
  number: Type.Integer({ minimum: 0 }),
  absoluteNumber: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  title: Type.Union([Type.String(), Type.Null()]),
  synopsis: Type.Union([Type.String(), Type.Null()]),
  airedAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  durationSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  isFiller: Type.Boolean(),
  isRecap: Type.Boolean(),
  introStartSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  introEndSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  outroStartSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  /**
   * True when this specific episode needs an active VIP grant to actually
   * watch — either the whole entry is `vipOnly`, or this episode's own
   * `earlyAccessUntil` hasn't passed yet — AND the requesting viewer does
   * not currently have one. Metadata (title, synopsis, air date, ...)
   * stays visible either way; only playback is gated, matching how this
   * episode still shows up in the list rather than disappearing the way
   * an isAdult-gated title 404s outright. See `watch.service.ts` for the
   * actual playback-time enforcement this only previews.
   */
  requiresVip: Type.Boolean(),
  /**
   * The signed-in viewer's own progress on this episode, if any — null for
   * an anonymous request or an episode never started. Never another
   * viewer's data, same self-scoping every other progress read in this
   * app already has.
   */
  progress: Type.Union([EpisodeProgress, Type.Null()]),
});
export type EpisodeSummary = Static<typeof EpisodeSummary>;

/** The entry (release) an episode belongs to, as shown in the watch page header. */
export const EpisodeEntrySummary = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
  entryType: literalUnion(ENTRY_TYPES),
  seasonNumber: Type.Union([Type.Integer(), Type.Null()]),
  courNumber: Type.Union([Type.Integer(), Type.Null()]),
  status: literalUnion(RELEASE_STATUSES),
  poster: Type.Union([ImageRef, Type.Null()]),
});
export type EpisodeEntrySummary = Static<typeof EpisodeEntrySummary>;

/** The series an episode's entry belongs to — lets the watch header render "Attack on Titan — Season 2 — Episode 7" without a second request. */
export const EpisodeSeriesSummary = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
});
export type EpisodeSeriesSummary = Static<typeof EpisodeSeriesSummary>;

export const EpisodeWatchBootstrap = Type.Object({
  episode: EpisodeSummary,
  entry: EpisodeEntrySummary,
  series: EpisodeSeriesSummary,
  previousEpisodeId: Type.Union([Uuid, Type.Null()]),
  nextEpisodeId: Type.Union([Uuid, Type.Null()]),
  progress: Type.Union([EpisodeProgress, Type.Null()]),
  /**
   * True when `sources` was withheld because this viewer needs an active
   * VIP grant to watch this episode right now (mirrors
   * `episode.requiresVip`, repeated at the top level since this is the
   * field the watch page actually branches on). The page still loads
   * normally — title, synopsis, episode list — this is not a 404 the way
   * an isAdult-gated title is; the frontend shows a VIP-required prompt
   * in place of the player instead.
   */
  vipRequired: Type.Boolean(),
  sources: EpisodeSourceListResponse,
});
export type EpisodeWatchBootstrap = Static<typeof EpisodeWatchBootstrap>;

export const CalendarQuery = Type.Object({
  from: Type.String({ format: 'date' }),
  to: Type.String({ format: 'date' }),
});
export type CalendarQuery = Static<typeof CalendarQuery>;

export const CalendarEntry = Type.Object({
  date: Type.String({ format: 'date' }),
  episode: EpisodeSummary,
  entry: EpisodeEntrySummary,
  series: EpisodeSeriesSummary,
});
export type CalendarEntry = Static<typeof CalendarEntry>;

export const CalendarResponse = Type.Object({
  from: Type.String({ format: 'date' }),
  to: Type.String({ format: 'date' }),
  entries: Type.Array(CalendarEntry),
});
export type CalendarResponse = Static<typeof CalendarResponse>;
