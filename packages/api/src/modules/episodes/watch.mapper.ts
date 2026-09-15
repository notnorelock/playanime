import type { EpisodeRepository } from '@playanime/database';

type WatchRow = NonNullable<Awaited<ReturnType<EpisodeRepository['findWatchEpisode']>>>;

export function toWatchEpisode(row: WatchRow) {
  return {
    id: row.id,
    animeId: row.animeId,
    number: row.number,
    absoluteNumber: row.absoluteNumber,
    title: row.title,
    titlePolish: row.titlePolish,
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

export function toWatchAnime(row: WatchRow) {
  return {
    id: row.animeId,
    slug: row.animeSlug,
    title: row.animeTitle,
    format: row.animeFormat,
    status: row.animeStatus,
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
