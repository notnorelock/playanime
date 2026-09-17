import { Type, type Static } from '@sinclair/typebox';
import { ImageRef, IsoDateTime, Slug, Uuid, literalUnion } from '../common/index.js';
import { RELEASE_STATUSES, TITLE_FORMATS } from './enums.js';
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
  animeId: Uuid,
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
   * The signed-in viewer's own progress on this episode, if any — null for
   * an anonymous request or an episode never started. Never another
   * viewer's data, same self-scoping every other progress read in this
   * app already has.
   */
  progress: Type.Union([EpisodeProgress, Type.Null()]),
});
export type EpisodeSummary = Static<typeof EpisodeSummary>;

export const EpisodeAnimeSummary = Type.Object({
  id: Uuid,
  slug: Slug,
  title: Type.String(),
  format: literalUnion(TITLE_FORMATS),
  status: literalUnion(RELEASE_STATUSES),
  poster: Type.Union([ImageRef, Type.Null()]),
});
export type EpisodeAnimeSummary = Static<typeof EpisodeAnimeSummary>;

export const EpisodeWatchBootstrap = Type.Object({
  episode: EpisodeSummary,
  anime: EpisodeAnimeSummary,
  previousEpisodeId: Type.Union([Uuid, Type.Null()]),
  nextEpisodeId: Type.Union([Uuid, Type.Null()]),
  progress: Type.Union([EpisodeProgress, Type.Null()]),
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
  anime: EpisodeAnimeSummary,
});
export type CalendarEntry = Static<typeof CalendarEntry>;

export const CalendarResponse = Type.Object({
  from: Type.String({ format: 'date' }),
  to: Type.String({ format: 'date' }),
  entries: Type.Array(CalendarEntry),
});
export type CalendarResponse = Static<typeof CalendarResponse>;
