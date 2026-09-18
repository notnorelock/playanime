import type { EpisodeProgress, SeriesSummaryDto } from '@playanime/contracts';
import type { LibraryRepository } from '@playanime/database';

type LibraryRow = Awaited<ReturnType<LibraryRepository['list']>>[number];
type ContinueRow = Awaited<ReturnType<LibraryRepository['listContinueWatching']>>[number];
type ProgressRow = NonNullable<Awaited<ReturnType<LibraryRepository['findProgress']>>>;

/**
 * Neither `LibraryRow` nor `ContinueRow` carries a series-level
 * format/status/season/episodeCount — those live on the series' main
 * entry, which these queries do not join (the library list shows many
 * series at once; joining each one's main entry here would be exactly
 * the N+1 the catalogue read path avoids elsewhere). Card consumers that
 * need those fields read `GET /catalogue/series/:slug` instead.
 */
function librarySeriesDto(row: LibraryRow): SeriesSummaryDto {
  return {
    id: row.seriesId,
    slug: row.slug,
    title: row.title,
    format: null,
    status: null,
    season: null,
    seasonYear: null,
    episodeCount: null,
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    poster:
      row.posterUrl === null
        ? null
        : {
            url: row.posterUrl,
            blurhash: row.posterBlurhash,
            width: row.posterWidth,
            height: row.posterHeight,
          },
    genres: [],
  };
}

function continueWatchingSeriesDto(row: ContinueRow): SeriesSummaryDto {
  return {
    id: row.seriesId,
    slug: row.slug,
    title: row.title,
    format: row.entryType,
    status: row.entryStatus,
    season: null,
    seasonYear: null,
    episodeCount: null,
    averageRating: row.averageRating === null ? null : Number(row.averageRating),
    poster:
      row.posterUrl === null
        ? null
        : {
            url: row.posterUrl,
            blurhash: row.posterBlurhash,
            width: row.posterWidth,
            height: row.posterHeight,
          },
    genres: [],
  };
}

export function toLibraryEntry(row: LibraryRow) {
  return {
    id: row.id,
    series: librarySeriesDto(row),
    status: row.status,
    progressEpisodes: row.progressEpisodes,
    rewatchCount: row.rewatchCount,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    notes: row.notes,
    isPrivate: row.isPrivate,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toProgress(row: ProgressRow): EpisodeProgress {
  return {
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    isCompleted: row.isCompleted,
    lastWatchedAt: row.lastWatchedAt.toISOString(),
  };
}

export function toContinueWatching(row: ContinueRow) {
  return {
    series: continueWatchingSeriesDto(row),
    entry: {
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
    },
    episode: {
      id: row.episodeId,
      entryId: row.entryId,
      number: row.episodeNumber,
      absoluteNumber: row.absoluteNumber,
      title: row.episodeTitle,
      synopsis: row.episodeSynopsis,
      airedAt: row.airedAt,
      durationSeconds: row.episodeDuration,
      isFiller: row.isFiller,
      isRecap: row.isRecap,
      introStartSeconds: row.introStartSeconds,
      introEndSeconds: row.introEndSeconds,
      outroStartSeconds: row.outroStartSeconds,
    },
    positionSeconds: row.positionSeconds,
    durationSeconds: row.progressDuration,
    lastWatchedAt: row.lastWatchedAt.toISOString(),
  };
}
