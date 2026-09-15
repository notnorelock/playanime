import type { AnimeSummary, EpisodeProgress } from '@playanime/contracts';
import type { LibraryRepository } from '@playanime/database';

type LibraryRow = Awaited<ReturnType<LibraryRepository['list']>>[number];
type ContinueRow = Awaited<ReturnType<LibraryRepository['listContinueWatching']>>[number];
type ProgressRow = NonNullable<Awaited<ReturnType<LibraryRepository['findProgress']>>>;

function animeDto(row: LibraryRow | ContinueRow): AnimeSummary {
  return {
    id: row.animeId,
    slug: row.slug,
    titles: {
      romaji: row.titleRomaji,
      english: row.titleEnglish,
      native: row.titleNative,
      polish: row.titlePolish,
    },
    format: row.format,
    status: row.releaseStatus,
    season: row.season,
    seasonYear: row.seasonYear,
    episodeCount: row.episodeCount,
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
    anime: animeDto(row),
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
    anime: animeDto(row),
    episode: {
      id: row.episodeId,
      animeId: row.animeId,
      number: row.episodeNumber,
      absoluteNumber: row.absoluteNumber,
      title: row.episodeTitle,
      titlePolish: row.episodeTitlePolish,
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
