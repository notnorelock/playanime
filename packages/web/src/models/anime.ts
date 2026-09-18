import type {
  AnimeTitles,
  EntryDetailDto,
  EntrySummaryDto,
  EpisodeEntrySummary,
  EpisodeSeriesSummary,
  ImageRef,
  ReleaseStatus,
  SeriesDetailDto,
  SeriesSummaryDto,
  EntryType,
} from '@playanime/contracts';

/**
 * Presentation models.
 *
 * The catalogue is `Series -> Entry -> Episode`. A Series is what a viewer
 * rates/lists/searches for ("Attack on Titan"); an Entry is one watchable
 * release under it (a season, a cour, a movie, an OVA...) with its own
 * format/dates/genres/synopsis. Components should not each re-derive "which
 * title do I show" and "what if there is no poster", so that decision is
 * made once, here, and the components consume flat view models.
 *
 * These adapters are explicit and one-directional: a DTO goes in, a view
 * model comes out. Nothing mutates the DTO, so a cached API response is
 * never silently rewritten by whichever component rendered it first.
 */

/** A catalogue card — one Series, shown before any Entry is picked. */
export interface AnimeCardModel {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  /** A series has one plain title (no romaji/english/native split); always null here, kept so cards using either model don't need a type guard. */
  readonly alternativeTitle: string | null;
  readonly posterUrl: string | null;
  readonly posterBlurhash: string | null;
  /** From the series' default entry; null for a series with no entry yet. */
  readonly format: EntryType | null;
  readonly status: ReleaseStatus | null;
  readonly year: number | null;
  readonly season: string | null;
  readonly episodeCount: number | null;
  /** Out of 5, not the API's native 1-10 — converted once here so every card, hero and detail view agrees on the scale. */
  readonly rating: number | null;
  readonly genres: readonly { slug: string; name: string }[];
}

function imageUrl(image: ImageRef | null): string | null {
  return image === null ? null : image.url;
}

export function toAnimeCardModel(series: SeriesSummaryDto): AnimeCardModel {
  return {
    id: series.id,
    slug: series.slug,
    title: series.title,
    alternativeTitle: null,
    posterUrl: imageUrl(series.poster),
    posterBlurhash: series.poster?.blurhash ?? null,
    format: series.format,
    status: series.status,
    year: series.seasonYear,
    season: series.season,
    episodeCount: series.episodeCount,
    rating: series.averageRating === null ? null : series.averageRating / 2,
    genres: series.genres,
  };
}

export interface SeriesDetailModel extends AnimeCardModel {
  readonly synopsis: string | null;
  readonly bannerUrl: string | null;
  readonly franchiseId: string | null;
  readonly ratingCount: number;
  /** The season/extras breakdown — every release under this series, in release order. */
  readonly entries: readonly EntrySummaryDto[];
}

export function toSeriesDetailModel(series: SeriesDetailDto): SeriesDetailModel {
  return {
    ...toAnimeCardModel(series),
    synopsis: series.synopsis,
    bannerUrl: imageUrl(series.banner),
    franchiseId: series.franchiseId,
    ratingCount: series.ratingCount,
    entries: series.entries,
  };
}

/** Picks the default entry to show first — the main numbered entry, or the first one otherwise. */
export function pickDefaultEntry(entries: readonly EntrySummaryDto[]): EntrySummaryDto | null {
  return entries.find((entry) => entry.isMainEntry) ?? entries[0] ?? null;
}

/**
 * Picks the title to display.
 *
 * A title is never translated — English when the viewer's locale is English,
 * romaji otherwise, which every entry is guaranteed to have. Translation
 * happens in the content (subtitles, episode titles), not in the release's
 * own name, the same way MAL or AniList never localize a title either.
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

/** One release — a season/cour/movie/OVA card, as shown in the detail page's season selector. */
export interface EntryCardModel {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly alternativeTitle: string | null;
  readonly entryType: EntryType;
  readonly seasonNumber: number | null;
  readonly courNumber: number | null;
  readonly status: ReleaseStatus;
  readonly episodeCount: number | null;
  readonly posterUrl: string | null;
  readonly posterBlurhash: string | null;
  readonly isMainEntry: boolean;
}

export function toEntryCardModel(entry: EntrySummaryDto, locale = 'pl'): EntryCardModel {
  const title = pickTitle(entry.titles, locale);
  return {
    id: entry.id,
    slug: entry.slug,
    title,
    alternativeTitle: pickAlternative(entry.titles, title),
    entryType: entry.entryType,
    seasonNumber: entry.seasonNumber,
    courNumber: entry.courNumber,
    status: entry.status,
    episodeCount: entry.episodeCount,
    posterUrl: imageUrl(entry.poster),
    posterBlurhash: entry.poster?.blurhash ?? null,
    isMainEntry: entry.isMainEntry,
  };
}

/** Full detail for one entry — synopsis, dates, studios/genres/tags all live here, not on the series. */
export interface EntryDetailModel extends EntryCardModel {
  readonly synopsis: string | null;
  readonly bannerUrl: string | null;
  readonly studios: readonly { slug: string; name: string; isPrimary: boolean }[];
  readonly tags: readonly { slug: string; name: string; category: string | null }[];
  readonly ageRating: string | null;
  readonly durationMinutes: number | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly airingSeason: string | null;
  readonly airingYear: number | null;
  readonly releaseOrder: number | null;
  readonly chronologicalOrder: number | null;
  readonly createdByGroupId: string | null;
  readonly anilistId: number | null;
}

export function toEntryDetailModel(entry: EntryDetailDto, locale = 'pl'): EntryDetailModel {
  return {
    ...toEntryCardModel(entry, locale),
    synopsis: entry.synopsis,
    bannerUrl: imageUrl(entry.banner),
    studios: entry.studios,
    tags: entry.tags,
    ageRating: entry.ageRating,
    durationMinutes: entry.durationMinutes,
    startDate: entry.startDate,
    endDate: entry.endDate,
    airingSeason: entry.airingSeason,
    airingYear: entry.airingYear,
    releaseOrder: entry.releaseOrder,
    chronologicalOrder: entry.chronologicalOrder,
    createdByGroupId: entry.createdByGroupId,
    anilistId: entry.anilistId,
  };
}

/** The compact entry shape the watch endpoint returns — for the watch page header ("Season 2"). */
export function toEntryCardModelFromWatch(entry: EpisodeEntrySummary): EntryCardModel {
  return {
    id: entry.id,
    slug: entry.slug,
    title: entry.title,
    alternativeTitle: null,
    entryType: entry.entryType,
    seasonNumber: entry.seasonNumber,
    courNumber: entry.courNumber,
    status: entry.status,
    episodeCount: null,
    posterUrl: imageUrl(entry.poster),
    posterBlurhash: entry.poster?.blurhash ?? null,
    isMainEntry: true,
  };
}

/**
 * An entry a translator group claims, shown as a card on the group's own
 * page — the group credits a specific release, not a whole series, but the
 * card still needs to route to a real page, so it links to the owning
 * series (`seriesSlug`) rather than a per-entry URL, which doesn't exist yet.
 */
export function toAnimeCardModelFromEntry(entry: EntrySummaryDto, seriesSlug: string, locale = 'pl'): AnimeCardModel {
  const title = pickTitle(entry.titles, locale)
  return {
    id: entry.id,
    slug: seriesSlug,
    title,
    alternativeTitle: pickAlternative(entry.titles, title),
    posterUrl: imageUrl(entry.poster),
    posterBlurhash: entry.poster?.blurhash ?? null,
    format: entry.entryType,
    status: entry.status,
    year: entry.airingYear,
    season: entry.airingSeason,
    episodeCount: entry.episodeCount,
    rating: null,
    genres: [],
  };
}

/** The compact series shape the watch endpoint returns — for the watch page header ("Attack on Titan"). */
export interface WatchSeriesModel {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
}

export function toSeriesModelFromWatch(series: EpisodeSeriesSummary): WatchSeriesModel {
  return { id: series.id, slug: series.slug, title: series.title };
}
