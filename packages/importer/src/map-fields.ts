import { ReleaseStatus, SeasonOfYear, TitleFormat } from '@playanime/contracts';
import type { AniListDate, AniListMedia, MappedAnime } from './types.js';

/**
 * AniList's `format`/`status`/`season` enums are the same set of values as
 * this app's own (just upper snake case) — a lookup table rather than a
 * plain `.toLowerCase()` so an AniList value this app has no matching enum
 * member for fails loudly (returns null, logged and skipped by the caller)
 * instead of writing an invalid string into a pgEnum column and failing at
 * the database, far from the actual cause.
 */
const FORMAT_MAP: Record<string, TitleFormat> = {
  TV: TitleFormat.TV,
  TV_SHORT: TitleFormat.TV_SHORT,
  MOVIE: TitleFormat.MOVIE,
  OVA: TitleFormat.OVA,
  ONA: TitleFormat.ONA,
  SPECIAL: TitleFormat.SPECIAL,
  MUSIC: TitleFormat.MUSIC,
};

const STATUS_MAP: Record<string, ReleaseStatus> = {
  FINISHED: ReleaseStatus.FINISHED,
  RELEASING: ReleaseStatus.RELEASING,
  NOT_YET_RELEASED: ReleaseStatus.NOT_YET_RELEASED,
  CANCELLED: ReleaseStatus.CANCELLED,
  HIATUS: ReleaseStatus.HIATUS,
};

const SEASON_MAP: Record<string, SeasonOfYear> = {
  WINTER: SeasonOfYear.WINTER,
  SPRING: SeasonOfYear.SPRING,
  SUMMER: SeasonOfYear.SUMMER,
  FALL: SeasonOfYear.FALL,
};

export function mapFormat(value: string | null): TitleFormat | null {
  if (value === null) return null;
  return FORMAT_MAP[value] ?? null;
}

export function mapStatus(value: string | null): ReleaseStatus {
  if (value === null) return ReleaseStatus.NOT_YET_RELEASED;
  return STATUS_MAP[value] ?? ReleaseStatus.NOT_YET_RELEASED;
}

export function mapSeason(value: string | null): SeasonOfYear | null {
  if (value === null) return null;
  return SEASON_MAP[value] ?? null;
}

/** AniList splits a date into year/month/day, any of which may be null (an unannounced end date, say). */
export function mapDate(date: AniListDate): string | null {
  if (date.year === null || date.month === null || date.day === null) return null;
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${String(date.year)}-${month}-${day}`;
}

/**
 * AniList's `averageScore` is 0-100; this app stores a 0.00-10.00
 * `numeric(4,2)` (see anime.ts's own comment on why precision 4 and not
 * 3). Null when AniList hasn't scored the title yet, matching the
 * column's own nullability.
 */
export function mapAverageRating(averageScore: number | null): string | null {
  if (averageScore === null) return null;
  return (averageScore / 10).toFixed(2);
}

/**
 * Strips the inline HTML AniList's `description` field still contains
 * even when queried with `asHtml: false` — confirmed directly against
 * the live API (`<br>` and `<i>` tags present in a real response, e.g.
 * AniList id 1535's synopsis) rather than assumed from documentation.
 * `<br>` becomes a real newline (it is one, semantically); every other
 * tag is simply removed, and any `<`/`>` entity-decoded elsewhere in the
 * source is left alone since it was never a tag to begin with.
 */
export function stripAniListHtml(text: string | null): string | null {
  if (text === null) return null;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>/gi, '')
    // AniList commonly pairs two <br> per paragraph break, which after the
    // replace above becomes 3+ blank lines in a row — collapse to one.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Maps one AniList media entry into this app's insert shape. Returns null
 * (never throws) when the entry is missing a field this schema requires
 * NOT NULL — `format` and a romaji title — so the caller can skip and log
 * one bad entry rather than aborting the whole sync run.
 */
export function mapAniListMedia(media: AniListMedia): MappedAnime | null {
  const format = mapFormat(media.format);
  const titleRomaji = media.title.romaji ?? media.title.english ?? media.title.native;

  if (format === null || titleRomaji === null) return null;

  return {
    anilistId: media.id,
    malId: media.idMal,
    titleRomaji,
    titleEnglish: media.title.english,
    titleNative: media.title.native,
    synopsis: stripAniListHtml(media.description),
    format,
    status: mapStatus(media.status),
    season: mapSeason(media.season),
    seasonYear: media.seasonYear,
    startDate: mapDate(media.startDate),
    endDate: mapDate(media.endDate),
    episodeCount: media.episodes,
    durationMinutes: media.duration,
    isAdult: media.isAdult,
    averageRating: mapAverageRating(media.averageScore),
    popularityScore: media.popularity ?? 0,
    genreNames: media.genres,
    tags: media.tags,
    studioNames: media.studios.filter((s) => s.isMain).map((s) => s.name),
    posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    bannerUrl: media.bannerImage,
  };
}
