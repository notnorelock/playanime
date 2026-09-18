import type { EntryDetailDto, ImageRef, SeriesDetailDto, SeriesSummaryDto } from '@playanime/contracts';
import type { AnimeDetailRow, AnimeListRow, AnimeRepository } from '@playanime/database';

/**
 * Row-to-DTO mapping.
 *
 * This is the boundary between storage and the public API. Every field that
 * reaches a client passes through an explicit assignment here, so exposing a
 * new column is a visible change in a diff rather than an automatic
 * consequence of adding it to the table.
 *
 * Spreading a row into a response would make every future column public by
 * default. That is precisely the mistake `@playanime/contracts` exists to
 * prevent.
 *
 * `format`/`status`/`season`/`seasonYear`/`episodeCount` here come from the
 * series' main entry (joined by the repository) — a series without one yet
 * shows nulls, which is a real, representable state, not a bug.
 */

function toImageRef(
  url: string | null,
  blurhash: string | null,
  width: number | null,
  height: number | null,
): ImageRef | null {
  if (url === null) return null;
  return { url, blurhash, width, height };
}

export function toAnimeSummary(
  row: AnimeListRow,
  genres: readonly { slug: string; name: string }[] = [],
): SeriesSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    format: row.format,
    status: row.status,
    season: row.season,
    seasonYear: row.seasonYear,
    episodeCount: row.episodeCount,
    // numeric(3,2) arrives as a string from the driver; the wire contract
    // declares a number, so the conversion happens here rather than leaking a
    // stringly-typed rating to every consumer.
    averageRating: row.averageRating === null ? null : Number.parseFloat(row.averageRating),
    poster: toImageRef(row.posterUrl, row.posterBlurhash, row.posterWidth, row.posterHeight),
    genres: genres.map((genre) => ({ slug: genre.slug, name: genre.name })),
  };
}

export function toAnimeDetail(
  row: AnimeDetailRow,
  genres: readonly { slug: string; name: string }[],
  entries: SeriesDetailDto['entries'] = [],
): SeriesDetailDto {
  const summary = toAnimeSummary(row, genres);
  return {
    ...summary,
    synopsis: row.synopsis,
    banner: toImageRef(row.bannerUrl, row.bannerBlurhash, row.bannerWidth, row.bannerHeight),
    franchiseId: row.franchiseId,
    ratingCount: row.ratingCount,
    isAdult: row.isAdult,
    updatedAt: row.updatedAt.toISOString(),
    entries,
  };
}

export function toEntryDetail(row: NonNullable<Awaited<ReturnType<AnimeRepository['findEntryDetail']>>>): EntryDetailDto {
  return {
    id: row.id,
    seriesId: row.seriesId,
    slug: row.slug,
    entryType: row.entryType,
    titles: {
      romaji: row.titleRomaji,
      english: row.titleEnglish,
      native: row.titleNative,
    },
    seasonNumber: row.seasonNumber,
    courNumber: row.courNumber,
    airingSeason: row.airingSeason,
    airingYear: row.airingYear,
    status: row.status,
    episodeCount: row.episodeCount,
    poster: toImageRef(row.posterUrl, row.posterBlurhash, row.posterWidth, row.posterHeight),
    releaseOrder: row.releaseOrder,
    chronologicalOrder: row.chronologicalOrder,
    isMainEntry: row.isMainEntry,
    synopsis: row.synopsis,
    ageRating: row.ageRating,
    durationMinutes: row.durationMinutes,
    startDate: row.startDate,
    endDate: row.endDate,
    banner: toImageRef(row.bannerUrl, row.bannerBlurhash, row.bannerWidth, row.bannerHeight),
    assets: [],
    studios: row.studios,
    genres: row.genres,
    tags: row.tags,
    isAdult: row.isAdult,
    updatedAt: row.updatedAt.toISOString(),
    createdByGroupId: row.createdByGroupId,
    anilistId: row.anilistId,
  };
}
