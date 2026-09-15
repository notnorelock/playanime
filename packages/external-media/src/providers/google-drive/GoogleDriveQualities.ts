/**
 * itag → resolution for Drive/YouTube-family progressive and adaptive itags.
 *
 * Used only when the player response omitted width/height. Unknown itags yield
 * `undefined` rather than a guessed resolution — the player then shows the
 * variant without a quality label instead of fabricating one.
 */
const ITAG_RESOLUTION: Readonly<Record<number, number>> = {
  5: 240,
  6: 270,
  13: 144,
  17: 144,
  18: 360,
  22: 720,
  34: 360,
  35: 480,
  36: 240,
  37: 1080,
  38: 3072,
  43: 360,
  44: 480,
  45: 720,
  46: 1080,
  59: 480,
  78: 480,
  82: 360,
  83: 480,
  84: 720,
  85: 1080,
  92: 240,
  93: 360,
  94: 480,
  95: 720,
  96: 1080,
  132: 240,
  133: 240,
  134: 360,
  135: 480,
  136: 720,
  137: 1080,
  151: 72,
  160: 144,
  242: 240,
  243: 360,
  244: 480,
  247: 720,
  248: 1080,
  264: 1440,
  266: 2160,
  271: 1440,
  272: 2160,
  278: 144,
  298: 720,
  299: 1080,
  302: 720,
  303: 1080,
  308: 1440,
  313: 2160,
  315: 2160,
  330: 144,
  331: 240,
  332: 360,
  333: 480,
  334: 720,
  335: 1080,
  336: 1440,
  337: 2160,
};

export function resolutionFromItag(itag: number | undefined): number | undefined {
  if (itag === undefined) return undefined;
  return ITAG_RESOLUTION[itag];
}

export function isKnownItag(itag: number): boolean {
  return Object.hasOwn(ITAG_RESOLUTION, itag);
}

export interface QualityVariant {
  readonly src: string;
  readonly resolution?: number;
  readonly mimeType?: string;
  readonly itag?: number;
  readonly contentLength?: number;
}

/**
 * Prefer the measured height from Drive metadata; fall back to the itag table.
 * Never invent a resolution when both are missing.
 */
export function normalizeResolution(
  height: number | undefined,
  itag: number | undefined,
): number | undefined {
  if (height !== undefined && height > 0) return height;
  return resolutionFromItag(itag);
}

function mimeRank(mimeType: string | undefined): number {
  if (mimeType === undefined) return 0;
  if (mimeType.includes('mp4')) return 3;
  if (mimeType.includes('webm')) return 2;
  return 1;
}

/**
 * Highest resolution first. Duplicate resolutions keep the variant that is
 * more likely to play natively (mp4 over webm, larger contentLength).
 */
export function sortAndDedupeVariants<T extends QualityVariant>(variants: readonly T[]): T[] {
  const sorted = [...variants].sort((a, b) => {
    const res = (b.resolution ?? 0) - (a.resolution ?? 0);
    if (res !== 0) return res;
    const mime = mimeRank(b.mimeType) - mimeRank(a.mimeType);
    if (mime !== 0) return mime;
    return (b.contentLength ?? 0) - (a.contentLength ?? 0);
  });

  const seen = new Set<number>();
  const unique: T[] = [];

  for (const variant of sorted) {
    if (variant.resolution === undefined) {
      unique.push(variant);
      continue;
    }
    if (seen.has(variant.resolution)) continue;
    seen.add(variant.resolution);
    unique.push(variant);
  }

  return unique;
}

export function highestResolution(variants: readonly QualityVariant[]): number | undefined {
  let highest: number | undefined;
  for (const variant of variants) {
    if (variant.resolution === undefined) continue;
    if (highest === undefined || variant.resolution > highest) highest = variant.resolution;
  }
  return highest;
}
