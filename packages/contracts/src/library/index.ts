import { Type, type Static } from '@sinclair/typebox';
import { AnimeSummary, WATCH_STATUSES } from '../anime/index.js';
import { CursorPageOf, CursorQuery, IsoDateTime, literalUnion, Uuid } from '../common/index.js';
import { EpisodeSummary } from '../anime/episodes.js';

export const LibraryEntry = Type.Object({
  id: Uuid,
  anime: AnimeSummary,
  status: literalUnion(WATCH_STATUSES),
  progressEpisodes: Type.Integer({ minimum: 0 }),
  rewatchCount: Type.Integer({ minimum: 0 }),
  startedAt: Type.Union([IsoDateTime, Type.Null()]),
  finishedAt: Type.Union([IsoDateTime, Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  isPrivate: Type.Boolean(),
  updatedAt: IsoDateTime,
});
export type LibraryEntry = Static<typeof LibraryEntry>;

export const LibraryQuery = Type.Object({
  ...CursorQuery.properties,
  status: Type.Optional(literalUnion(WATCH_STATUSES)),
});
export type LibraryQuery = Static<typeof LibraryQuery>;

export const LibraryPage = CursorPageOf(LibraryEntry);
export type LibraryPage = Static<typeof LibraryPage>;

export const LibraryUpsertBody = Type.Object({
  status: literalUnion(WATCH_STATUSES),
  progressEpisodes: Type.Optional(Type.Integer({ minimum: 0 })),
  rewatchCount: Type.Optional(Type.Integer({ minimum: 0 })),
  notes: Type.Optional(Type.Union([Type.String({ maxLength: 1000 }), Type.Null()])),
  isPrivate: Type.Optional(Type.Boolean()),
});
export type LibraryUpsertBody = Static<typeof LibraryUpsertBody>;

export const ProgressUpsertBody = Type.Object({
  positionSeconds: Type.Integer({ minimum: 0 }),
  durationSeconds: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  isCompleted: Type.Optional(Type.Boolean()),
});
export type ProgressUpsertBody = Static<typeof ProgressUpsertBody>;

export const ContinueWatchingItem = Type.Object({
  anime: AnimeSummary,
  episode: EpisodeSummary,
  positionSeconds: Type.Integer({ minimum: 0 }),
  durationSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  lastWatchedAt: IsoDateTime,
});
export type ContinueWatchingItem = Static<typeof ContinueWatchingItem>;

export const ContinueWatchingResponse = Type.Array(ContinueWatchingItem);
export type ContinueWatchingResponse = Static<typeof ContinueWatchingResponse>;
