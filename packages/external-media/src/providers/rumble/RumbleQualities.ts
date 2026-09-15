import type { HlsVariant, PlaybackSource } from '@playanime/contracts';
import type { RumbleLadderRung, RumblePlaybackSource } from './RumbleTypes.js';
import { isAllowedRumbleMediaUrl } from './RumbleUrls.js';

/**
 * Turning Rumble renditions into player-facing qualities.
 *
 * Two rules drive everything here:
 *
 * 1. Never fabricate a resolution. A rendition Rumble described without usable
 *    dimensions is still offered, just without a quality label — the player
 *    renders it unlabelled rather than guessing "720p".
 * 2. Never emit a URL that is not on a Rumble host, even when it arrived inside
 *    a genuine Rumble response.
 */

/** Progressive formats, best-playing container first. */
const CONTAINER_RANK: Readonly<Record<string, number>> = {
  mp4: 2,
  webm: 1,
};

export function isProgressive(source: RumblePlaybackSource): boolean {
  return source.type === 'mp4' || source.type === 'webm';
}

export function isAdaptive(source: RumblePlaybackSource): boolean {
  return source.type === 'hls';
}

/** Drops anything that is not https-on-a-Rumble-host. */
export function withAllowedHostsOnly(
  sources: readonly RumblePlaybackSource[],
): RumblePlaybackSource[] {
  return sources.filter((source) => isAllowedRumbleMediaUrl(source.url));
}

/**
 * Highest resolution first; ties broken toward the container more likely to
 * play natively, then the higher bitrate.
 *
 * Unlabelled renditions sort last so a labelled quality is always the default.
 */
export function sortProgressiveSources(
  sources: readonly RumblePlaybackSource[],
): RumblePlaybackSource[] {
  return [...sources].sort((a, b) => {
    const resolution = (b.resolution ?? 0) - (a.resolution ?? 0);
    if (resolution !== 0) return resolution;

    const container = (CONTAINER_RANK[b.type] ?? 0) - (CONTAINER_RANK[a.type] ?? 0);
    if (container !== 0) return container;

    return (b.bitrate ?? 0) - (a.bitrate ?? 0);
  });
}

/**
 * One entry per resolution.
 *
 * Duplicate heights across containers would show the viewer "720p" twice, so
 * the better-ranked container wins. Unlabelled renditions are all kept: without
 * a resolution there is no basis for calling them duplicates.
 */
export function dedupeByResolution(
  sources: readonly RumblePlaybackSource[],
): RumblePlaybackSource[] {
  const seen = new Set<number>();
  const unique: RumblePlaybackSource[] = [];

  for (const source of sources) {
    if (source.resolution === undefined) {
      unique.push(source);
      continue;
    }
    if (seen.has(source.resolution)) continue;
    seen.add(source.resolution);
    unique.push(source);
  }

  return unique;
}

/** Progressive renditions, filtered and ordered for the descriptor. */
export function toPlaybackSources(
  sources: readonly RumblePlaybackSource[],
): PlaybackSource[] {
  const progressive = withAllowedHostsOnly(sources).filter(isProgressive);

  return dedupeByResolution(sortProgressiveSources(progressive)).map((source) => ({
    src: source.url,
    ...(source.resolution === undefined
      ? {}
      : { resolution: Math.round(source.resolution) }),
    ...(source.mimeType === undefined ? {} : { mimeType: source.mimeType }),
  }));
}

/**
 * The adaptive master playlist, if Rumble published one.
 *
 * Only the playlist URL is taken. Rumble's own ladder inside it is left alone —
 * expanding it here would duplicate logic hls.js already implements correctly.
 */
export function pickAdaptiveSource(
  sources: readonly RumblePlaybackSource[],
): RumblePlaybackSource | undefined {
  return withAllowedHostsOnly(sources).find(isAdaptive);
}

/**
 * Quality hints for the adaptive menu.
 *
 * Two sources, in order:
 *
 * 1. The ladder Rumble advertised for the stream. For a current VOD this comes
 *    from the archive entries whose metadata mirrors the master playlist
 *    exactly (verified against a real video), which is the only place the
 *    rungs appear for an HLS-only stream.
 * 2. Otherwise the progressive renditions listed beside the playlist.
 *
 * Purely informational either way: the player reads real levels from the
 * manifest, so a mismatch degrades the menu and never playback.
 */
export function toHlsVariants(
  sources: readonly RumblePlaybackSource[],
  ladder: readonly RumbleLadderRung[] = [],
): HlsVariant[] {
  const byResolution = new Map<number, HlsVariant>();

  for (const rung of ladder) {
    const resolution = Math.round(rung.resolution);
    if (byResolution.has(resolution)) continue;
    byResolution.set(resolution, {
      resolution,
      // Rumble reports kbps; the contract and hls.js both use bits per second.
      ...(rung.bitrate === undefined ? {} : { bandwidth: Math.round(rung.bitrate * 1000) }),
    });
  }

  if (byResolution.size === 0) {
    const labelled = withAllowedHostsOnly(sources).filter(isProgressive);

    for (const source of sortProgressiveSources(labelled)) {
      if (source.resolution === undefined) continue;

      const resolution = Math.round(source.resolution);
      if (byResolution.has(resolution)) continue;
      byResolution.set(resolution, {
        resolution,
        ...(source.bitrate === undefined ? {} : { bandwidth: Math.round(source.bitrate * 1000) }),
      });
    }
  }

  return [...byResolution.values()].sort((a, b) => b.resolution - a.resolution);
}

export function highestResolution(
  sources: readonly RumblePlaybackSource[],
): number | undefined {
  let highest: number | undefined;
  for (const source of sources) {
    if (source.resolution === undefined) continue;
    if (highest === undefined || source.resolution > highest) highest = source.resolution;
  }
  return highest;
}
