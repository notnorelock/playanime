import { encode } from 'blurhash';
import sharp from 'sharp';

/**
 * Real width/height plus a blurhash placeholder for one remote image.
 *
 * AniList (and every other source this importer reads from) only ever gives
 * a bare URL — never dimensions or a placeholder — so this app's own
 * `media_assets.width`/`height`/`blurhash` columns stay `null` forever
 * unless something actually fetches the bytes and decodes them. This is
 * that something. The image itself is never written to disk or any other
 * storage: it is downloaded into memory, decoded, measured, hashed, and
 * discarded — `media_assets.url` keeps pointing at the source CDN, exactly
 * as before.
 */
export interface ImageMeta {
  readonly width: number;
  readonly height: number;
  readonly blurhash: string;
}

/** Blurhash components — 4x3 is the library's own recommended default: enough gradient detail without a long string. */
const BLURHASH_COMPONENTS_X = 4;
const BLURHASH_COMPONENTS_Y = 3;

/**
 * blurhash's `encode` needs raw pixels at a size proportional to its
 * component count, not the source resolution — a cover image can be
 * several megapixels, all of which would be wasted work here. Downscaling
 * before encoding is the library's own documented usage pattern.
 */
const ENCODE_MAX_DIMENSION = 64;

/** A fetch this importer will not wait forever on for one bad/slow CDN response. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Downloads `url`, decodes it, and returns its real dimensions plus a
 * blurhash placeholder — or `null` if the fetch fails, the response isn't
 * actually an image, or sharp can't decode it. Never throws: one
 * unreachable or malformed image is not worth aborting an entire sync run
 * over, so the caller logs and moves on with the metadata columns left
 * `null`, exactly as they were before this existed.
 */
export async function fetchImageMeta(url: string): Promise<ImageMeta | null> {
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    bytes = await response.arrayBuffer();
  } catch {
    return null;
  }

  try {
    const image = sharp(Buffer.from(bytes));
    const metadata = await image.metadata();
    // sharp's `Metadata.width`/`height` are always defined once decoding
    // succeeds at all (they are plain `number`, never optional) — a decode
    // failure throws instead of returning partial metadata, which is
    // already handled by the catch below.
    const { width, height } = metadata;

    const scale = Math.min(1, ENCODE_MAX_DIMENSION / Math.max(width, height));
    const encodeWidth = Math.max(1, Math.round(width * scale));
    const encodeHeight = Math.max(1, Math.round(height * scale));

    const { data } = await image
      .resize(encodeWidth, encodeHeight, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const hash = encode(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      encodeWidth,
      encodeHeight,
      BLURHASH_COMPONENTS_X,
      BLURHASH_COMPONENTS_Y,
    );

    return { width, height, blurhash: hash };
  } catch {
    return null;
  }
}
