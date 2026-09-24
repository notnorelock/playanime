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

/** Discord-style pre-generated avatar sizes — every UI surface picks whichever fits instead of always loading the largest. */
export const AVATAR_SIZES = [64, 128, 256, 512] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export interface AvatarVariant {
  readonly size: AvatarSize;
  readonly bytes: Buffer;
}

export interface AvatarVariants {
  readonly variants: readonly AvatarVariant[];
  /** The base (largest) variant's actual dimensions — always square, so width === height. */
  readonly width: number;
  readonly height: number;
}

/**
 * Resizes an already-square, already-WebP image (the frontend crops to a
 * square before upload, and the caller has already run this through
 * `convertToWebp` — see media.service.ts) down to every size in
 * `AVATAR_SIZES`. `{ animated: true }` on the read side again preserves an
 * animated source's frames through every resize, same reasoning as
 * `convertToWebp` itself.
 */
export async function generateAvatarSizes(squareWebpBytes: Buffer): Promise<AvatarVariants> {
  const base = sharp(squareWebpBytes, { animated: true });
  const metadata = await base.metadata();
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;

  const variants = await Promise.all(
    AVATAR_SIZES.map(async (size): Promise<AvatarVariant> => {
      const bytes = await sharp(squareWebpBytes, { animated: true })
        .resize(size, size, { fit: 'cover' })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();
      return { size, bytes };
    }),
  );

  return { variants, width, height };
}
