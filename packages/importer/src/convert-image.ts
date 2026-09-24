import sharp from 'sharp';

/**
 * Converts arbitrary image bytes to WebP, preserving animation when the
 * source is animated (an animated GIF avatar becomes an animated WebP, not
 * a single frame of one) — sharp decodes every source format this app
 * accepts (PNG/JPEG/WebP/GIF) uniformly through libvips, so no per-format
 * branch is needed here; `{ animated: true }` on the read side is what
 * makes a multi-frame GIF's later frames survive the encode instead of
 * being silently dropped, which is sharp's default behavior without it.
 *
 * `quality` matches cwebp's own default (this is genuinely what "lightweight"
 * means for WebP — much smaller than the source PNG/JPEG at a difference
 * that isn't visible at avatar sizes) rather than a number picked without a
 * reference point.
 */
const WEBP_QUALITY = 80;

export async function convertToWebp(bytes: Uint8Array): Promise<Buffer> {
  return sharp(bytes, { animated: true }).webp({ quality: WEBP_QUALITY }).toBuffer();
}
