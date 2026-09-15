import type { AnimeSummary, ImageRef } from '@playanime/contracts';
import type { AnimeListRow } from '@playanime/database';

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
      polish: row.titlePolish,
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
