import type { AnimeRepository } from '@playanime/database';

type CalendarRow = Awaited<ReturnType<AnimeRepository['calendar']>>[number];

export function toCalendarEntry(row: CalendarRow, fallbackDate: string) {
  return {
    date: row.airedAt ?? fallbackDate,
    anime: {
      id: row.animeId,
      slug: row.slug,
      title: row.titleRomaji,
      format: row.format,
      status: row.status,
      poster:
        row.posterUrl === null
          ? null
          : {
              url: row.posterUrl,
              blurhash: row.posterBlurhash,
              width: row.posterWidth,
              height: row.posterHeight,
            },
    },
    episode: {
      id: row.episodeId,
      animeId: row.animeId,
      number: row.number,
      absoluteNumber: row.absoluteNumber,
      title: row.episodeTitle,
      synopsis: row.synopsis,
      airedAt: row.airedAt,
      durationSeconds: row.durationSeconds,
      isFiller: row.isFiller,
      isRecap: row.isRecap,
      introStartSeconds: row.introStartSeconds,
      introEndSeconds: row.introEndSeconds,
      outroStartSeconds: row.outroStartSeconds,
    },
  };
}
