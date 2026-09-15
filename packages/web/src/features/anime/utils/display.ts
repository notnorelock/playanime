import type { AnimeSummary, ReleaseStatus, SeasonOfYear, TitleFormat } from '@playanime/contracts';

/**
 * Display helpers for catalogue data.
 *
 * Polish labels live here rather than in components so a term is translated
 * once. These are not a substitute for real i18n — when a second locale is
 * added, these maps become the Polish catalogue.
 */

const FORMAT_LABELS: Readonly<Record<TitleFormat, string>> = {
  tv: 'Serial TV',
  tv_short: 'Krótki serial',
  movie: 'Film',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Odcinek specjalny',
  music: 'Teledysk',
};

const STATUS_LABELS: Readonly<Record<ReleaseStatus, string>> = {
  not_yet_released: 'Zapowiedziane',
  releasing: 'Emitowane',
  finished: 'Zakończone',
  hiatus: 'Wstrzymane',
  cancelled: 'Anulowane',
};

const SEASON_LABELS: Readonly<Record<SeasonOfYear, string>> = {
  winter: 'Zima',
  spring: 'Wiosna',
  summer: 'Lato',
  fall: 'Jesień',
};

export const formatLabel = (format: TitleFormat): string => FORMAT_LABELS[format];
export const statusLabel = (status: ReleaseStatus): string => STATUS_LABELS[status];
export const seasonLabel = (season: SeasonOfYear): string => SEASON_LABELS[season];

/**
 * The title to show, preferring Polish.
 *
 * Falls back through English to romaji. Romaji is always present, so this never
 * returns an empty string.
 */
export function displayTitle(anime: AnimeSummary): string {
  return anime.titles.polish ?? anime.titles.english ?? anime.titles.romaji;
}

/** The secondary title, shown beneath — omitted when it would repeat the primary. */
export function secondaryTitle(anime: AnimeSummary): string | null {
  const primary = displayTitle(anime);
  return anime.titles.romaji === primary ? null : anime.titles.romaji;
}

/** "Jesień 2025", or null when the broadcast season is unknown. */
export function seasonAndYear(anime: AnimeSummary): string | null {
  if (anime.season === null || anime.seasonYear === null) return null;
  return `${seasonLabel(anime.season)} ${String(anime.seasonYear)}`;
}

/** Formats a 0-10 rating to one decimal, e.g. "8.5". */
export function formatRating(rating: number | null): string | null {
  return rating === null ? null : rating.toFixed(1);
}

/** "12 odcinków" with correct Polish plural forms. */
export function episodeCountLabel(count: number | null): string | null {
  if (count === null) return null;
  if (count === 1) return '1 odcinek';

  // Polish uses the "few" form for 2-4 and for numbers ending 2-4, except the
  // teens. Getting this wrong is immediately obvious to a native speaker.
  const lastTwo = count % 100;
  const last = count % 10;
  const isFew = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);

  return `${String(count)} ${isFew ? 'odcinki' : 'odcinków'}`;
}
