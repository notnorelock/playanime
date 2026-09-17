/**
 * Shapes shared across the importer's client/mapping/sync files. Kept
 * intentionally narrow — only the fields the sync actually reads, not a
 * full mirror of either API's schema.
 */

export interface AniListTitle {
  readonly romaji: string | null;
  readonly english: string | null;
  readonly native: string | null;
}

export interface AniListDate {
  readonly year: number | null;
  readonly month: number | null;
  readonly day: number | null;
}

export interface AniListTag {
  readonly name: string;
  readonly category: string | null;
  readonly rank: number | null;
  readonly isAdult: boolean;
}

export interface AniListStudioEdge {
  readonly isMain: boolean;
  readonly name: string;
}

export interface AniListMedia {
  readonly id: number;
  readonly idMal: number | null;
  readonly title: AniListTitle;
  readonly format: string | null;
  readonly status: string | null;
  readonly season: string | null;
  readonly seasonYear: number | null;
  readonly startDate: AniListDate;
  readonly endDate: AniListDate;
  readonly episodes: number | null;
  readonly duration: number | null;
  readonly isAdult: boolean;
  readonly description: string | null;
  readonly genres: readonly string[];
  readonly tags: readonly AniListTag[];
  readonly studios: readonly AniListStudioEdge[];
  readonly coverImage: { readonly extraLarge: string | null; readonly large: string | null } | null;
  readonly bannerImage: string | null;
  readonly averageScore: number | null;
  readonly popularity: number | null;
}

export interface AniListPage {
  readonly hasNextPage: boolean;
  readonly media: readonly AniListMedia[];
}

/** The subset of Jikan's `/anime/{id}/full` response the importer reads. */
export interface JikanAnimeFull {
  readonly synopsis: string | null;
  readonly studios: readonly { readonly name: string }[];
}

/** A field this app's schema needs but AniList doesn't map 1:1. */
export interface MappedAnime {
  readonly anilistId: number;
  readonly malId: number | null;
  readonly titleRomaji: string;
  readonly titleEnglish: string | null;
  readonly titleNative: string | null;
  readonly synopsis: string | null;
  readonly format: string;
  readonly status: string;
  readonly season: string | null;
  readonly seasonYear: number | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly episodeCount: number | null;
  readonly durationMinutes: number | null;
  readonly isAdult: boolean;
  readonly averageRating: string | null;
  readonly popularityScore: number;
  readonly genreNames: readonly string[];
  readonly tags: readonly AniListTag[];
  readonly studioNames: readonly string[];
  readonly posterUrl: string | null;
  readonly bannerUrl: string | null;
}
