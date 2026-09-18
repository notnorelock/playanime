import type { AnimeRepository } from '@playanime/database';

type CalendarRow = Awaited<ReturnType<AnimeRepository['calendar']>>[number];

export function toCalendarEntry(row: CalendarRow, fallbackDate: string) {
  return {
    date: row.airedAt ?? fallbackDate,
    series: {
      id: row.seriesId,
      slug: row.slug,
      title: row.title,
    },
    entry: {
      id: row.entryId,
      slug: row.entrySlug,
      title: row.entryTitle,
      entryType: row.format,
      seasonNumber: null,
      courNumber: null,
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
      entryId: row.entryId,
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
