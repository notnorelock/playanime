import type {
  AnimeDetail,
  AnimeSummary,
  EpisodeAnimeSummary,
  AnimeTitles,
  ImageRef,
  ReleaseStatus,
  TitleFormat,
} from '@playanime/contracts';

/**
 * Presentation models.
 *
 * The API returns the catalogue in its own shape — a localized title set, a
 * nullable `ImageRef`, a rating that may be absent. Components should not each
 * re-derive "which title do I show" and "what if there is no poster", so that
 * decision is made once, here, and the components consume a flat model.
 *
 * These adapters are explicit and one-directional: a DTO goes in, a view model
 * comes out. Nothing mutates the DTO, so a cached API response is never
 * silently rewritten by whichever component rendered it first.
 */

export interface AnimeCardModel {
  readonly id: string;
  readonly slug: string;
  /** Title chosen for the active locale. Never empty. */
  readonly title: string;
  /** A different title worth showing alongside, or null when there is none. */
  readonly alternativeTitle: string | null;
  readonly posterUrl: string | null;
  readonly posterBlurhash: string | null;
  readonly format: TitleFormat;
  readonly status: ReleaseStatus;
  readonly year: number | null;
  readonly season: string | null;
  readonly episodeCount: number | null;
  /** Out of 5, not the API's native 1-10 — converted once here so every card, hero and detail view agrees on the scale. */
  readonly rating: number | null;
  readonly genres: readonly { slug: string; name: string }[];
}

/**
 * Picks the title to display.
 *
 * A title is never translated — English when the viewer's locale is English,
 * romaji otherwise, which every catalogue entry is guaranteed to have.
 * Translation happens in the content (subtitles, episode titles), not in the
 * show's own name, the same way MAL or AniList never localize a title either.
 */
export function pickTitle(titles: AnimeTitles, locale: string): string {
  if (locale.startsWith('en') && titles.english !== null && titles.english.length > 0) {
    return titles.english;
  }
  return titles.romaji;
}

/** The best *second* title, skipping whichever one is already displayed. */
function pickAlternative(titles: AnimeTitles, primary: string): string | null {
  for (const candidate of [titles.english, titles.romaji, titles.native]) {
    if (candidate !== null && candidate.length > 0 && candidate !== primary) return candidate;
  }
  return null;
}

function imageUrl(image: ImageRef | null): string | null {
  return image === null ? null : image.url;
}

export function toAnimeCardModel(anime: AnimeSummary, locale = 'pl'): AnimeCardModel {
  const title = pickTitle(anime.titles, locale);

  return {
    id: anime.id,
    slug: anime.slug,
    title,
    alternativeTitle: pickAlternative(anime.titles, title),
    posterUrl: imageUrl(anime.poster),
    posterBlurhash: anime.poster?.blurhash ?? null,
    format: anime.format,
    status: anime.status,
    year: anime.seasonYear,
    season: anime.season,
    episodeCount: anime.episodeCount,
    rating: anime.averageRating === null ? null : anime.averageRating / 2,
    genres: anime.genres,
  };
}

export interface AnimeDetailModel extends AnimeCardModel {
  readonly synopsis: string | null;
  readonly bannerUrl: string | null;
  readonly studios: readonly { slug: string; name: string; isPrimary: boolean }[];
  readonly ratingCount: number;
  readonly ageRating: string | null;
  readonly durationMinutes: number | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly createdByGroupId: string | null;
}

export function toAnimeDetailModel(anime: AnimeDetail, locale = 'pl'): AnimeDetailModel {
  return {
    ...toAnimeCardModel(anime, locale),
    synopsis: anime.synopsis,
    bannerUrl: imageUrl(anime.banner),
    studios: anime.studios,
    ratingCount: anime.ratingCount,
    ageRating: anime.ageRating,
    durationMinutes: anime.durationMinutes,
    startDate: anime.startDate,
    endDate: anime.endDate,
    createdByGroupId: anime.createdByGroupId,
  };
}

/**
 * The compact title shape the watch endpoint returns.
 *
 * It carries a single resolved `title` rather than the full localized set, so
 * it cannot go through `toAnimeCardModel` — hence a second, smaller adapter
 * rather than a set of optional fields on the first.
 */
export function toCardModelFromEpisodeAnime(anime: EpisodeAnimeSummary): AnimeCardModel {
  return {
    id: anime.id,
    slug: anime.slug,
    title: anime.title,
    alternativeTitle: null,
    posterUrl: imageUrl(anime.poster),
    posterBlurhash: anime.poster?.blurhash ?? null,
    format: anime.format,
    status: anime.status,
    year: null,
    season: null,
    episodeCount: null,
    rating: null,
    genres: [],
  };
}
