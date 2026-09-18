import type { ByseEmbedOptions } from './ByseTypes.js';
import { BYSE_DEFAULT_API_BASE, buildByseEmbedUrl } from './ByseUrls.js';

/**
 * Builds the final documented Byse embed URL: base player URL plus whichever
 * optional, documented query parameters apply.
 *
 * Every value goes through `URL`/`URLSearchParams`, never string
 * concatenation, so encoding is always correct and a subtitle label or poster
 * URL containing `&`/`=`/unicode cannot produce a malformed or duplicated
 * parameter.
 */
export function buildByseEmbedPlayerUrl(
  fileCode: string,
  apiBase: string = BYSE_DEFAULT_API_BASE,
  options: ByseEmbedOptions = {},
): string {
  const embed = new URL(buildByseEmbedUrl(fileCode, apiBase));

  if (options.autoplay === true) {
    embed.searchParams.set('autoplay', '1');
  }

  // Documented remote-subtitle pairs: c1_file/c1_label, c2_file/c2_label, ...
  // Order is preserved (array index -> track number) since it is what decides
  // which caption the player treats as first.
  (options.subtitles ?? []).forEach((track, index) => {
    if (!isHttpsUrl(track.url)) return;
    const label = track.label.trim();
    if (label.length === 0) return;

    const n = index + 1;
    embed.searchParams.set(`c${String(n)}_file`, track.url);
    embed.searchParams.set(`c${String(n)}_label`, label);
  });

  if (options.posterUrl !== undefined && isHttpsUrl(options.posterUrl)) {
    embed.searchParams.set('poster', options.posterUrl);
  }

  if (options.logoUrl !== undefined && isHttpsUrl(options.logoUrl)) {
    embed.searchParams.set('logo', options.logoUrl);
  }

  return embed.toString();
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
