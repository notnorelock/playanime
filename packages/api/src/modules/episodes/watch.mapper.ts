import type { EpisodeRepository } from '@playanime/database';

type WatchRow = NonNullable<Awaited<ReturnType<EpisodeRepository['findWatchEpisode']>>>;

export function toWatchEpisode(row: WatchRow) {
  return {
    id: row.id,
    entryId: row.entryId,
    number: row.number,
    absoluteNumber: row.absoluteNumber,
    title: row.title,
    synopsis: row.synopsis,
    airedAt: row.airedAt,
    durationSeconds: row.durationSeconds,
    isFiller: row.isFiller,
    isRecap: row.isRecap,
    introStartSeconds: row.introStartSeconds,
    introEndSeconds: row.introEndSeconds,
    outroStartSeconds: row.outroStartSeconds,
  };
}

export function toWatchEntry(row: WatchRow) {
  return {
    id: row.entryId,
    slug: row.entrySlug,
    title: row.entryTitle,
    entryType: row.entryType,
    seasonNumber: row.seasonNumber,
    courNumber: row.courNumber,
    status: row.entryStatus,
    poster:
      row.posterUrl === null
        ? null
        : {
            url: row.posterUrl,
            blurhash: row.posterBlurhash,
            width: row.posterWidth,
            height: row.posterHeight,
          },
  };
}

export function toWatchSeries(row: WatchRow) {
  return {
    id: row.seriesId,
    slug: row.seriesSlug,
    title: row.seriesTitle,
  };
}
