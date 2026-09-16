import type { AnimeDetail, AnimeSummary, ImageRef } from '@playanime/contracts';
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
): AnimeSummary {
  return {
    id: row.id,
    slug: row.slug,
    titles: {
      romaji: row.titleRomaji,
      english: row.titleEnglish,
      native: row.titleNative,
    },
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
  assets: Awaited<ReturnType<AnimeRepository['assetsFor']>>,
  studios: Awaited<ReturnType<AnimeRepository['studiosFor']>>,
): AnimeDetail {
  const summary = toAnimeSummary(row, genres);
  const banner = assets.find((asset) => asset.kind === 'banner' && asset.isPrimary) ?? null;
  return {
    ...summary,
    synopsis: row.synopsis,
    ageRating: row.ageRating,
    durationMinutes: row.durationMinutes,
    startDate: row.startDate,
    endDate: row.endDate,
    banner: banner === null ? null : toImageRef(banner.url, banner.blurhash, banner.width, banner.height),
    assets,
    studios,
    ratingCount: row.ratingCount,
    isAdult: row.isAdult,
    updatedAt: row.updatedAt.toISOString(),
    createdByGroupId: row.createdByGroupId,
  };
}
