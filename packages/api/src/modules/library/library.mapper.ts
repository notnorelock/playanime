import type { EpisodeProgress, SeriesSummaryDto } from '@playanime/contracts';
import type { LibraryRepository } from '@playanime/database';

type LibraryRow = Awaited<ReturnType<LibraryRepository['list']>>[number];
type ContinueRow = Awaited<ReturnType<LibraryRepository['listContinueWatching']>>[number];
type ProgressRow = NonNullable<Awaited<ReturnType<LibraryRepository['findProgress']>>>;

/**
 * `LibraryRow`/`ContinueRow` carry format/status/season/episodeCount/poster
 * from the series' main entry (a left join in the repository, same pattern
 * `AnimeRepository`'s own summary/detail queries use) — this used to
 * hardcode all of these to null with a doc comment justifying it as an
 * N+1 avoidance, which meant every library card rendered blank metadata
 * and no poster regardless of whether the series had one. A library list
 * is one page of a single user's entries, not the N+1-sensitive path that
 * justified skipping the join.
 */
function librarySeriesDto(row: LibraryRow): SeriesSummaryDto {
  return {
    id: row.seriesId,
    slug: row.slug,
    title: row.title,
    format: row.seriesFormat,
    status: row.seriesStatus,
    season: row.seriesSeason,
    seasonYear: row.seriesSeasonYear,
    episodeCount: row.seriesEpisodeCount,
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

/**
 * Deliberately uses the WATCHED entry's own type/status/season/episodeCount
 * fields (already selected explicitly below), not the series' main entry —
 * the continue-watching rail is about the specific release the viewer is
 * partway through, e.g. "Season 3" even when "Season 1" is the main entry.
 * `season`/`seasonYear`/`episodeCount` used to be hardcoded null here even
 * though the watched entry's own airingSeason/airingYear/episodeCount were
 * already selected — left every continue-watching card missing them for no
 * reason.
 */
function continueWatchingSeriesDto(row: ContinueRow): SeriesSummaryDto {
  return {
    id: row.seriesId,
    slug: row.slug,
    title: row.title,
    format: row.entryType,
    status: row.entryStatus,
    season: row.entryAiringSeason,
    seasonYear: row.entryAiringYear,
    episodeCount: row.entryEpisodeCount,
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
