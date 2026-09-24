import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@playanime/config';
import { convertToWebp } from '@playanime/importer';
import { PayloadTooLargeError, UnsupportedMediaTypeError } from '@playanime/shared';

/**
 * Uploads (an avatar today — see services/cdn/README.md for why this writes
 * to a shared volume rather than serving the file itself).
 *
 * The client's declared MIME type is never trusted: a browser sets it from
 * the file's extension or its own guess, and a caller could set anything at
 * all directly against this endpoint. The actual bytes are sniffed instead
 * (magic numbers) to decide whether the upload is even a real image sharp
 * can decode; every accepted upload is then re-encoded to WebP regardless
 * of its original format — this is what makes the stored file "lightweight"
 * rather than just accepting whatever size the original PNG/JPEG happened
 * to be, and it means the site never has to deal with more than one output
 * format for uploaded media. Animation survives the conversion (an animated
 * GIF avatar becomes an animated WebP, not one static frame) — see
 * convertToWebp's own doc comment for how.
 */

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Magic-number signatures for the image formats an upload may actually be — checked before spending a decode on it, so garbage input is rejected without ever reaching sharp. */
const IMAGE_SIGNATURES: readonly { format: string; magic: readonly number[] }[] = [
  { format: 'png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { format: 'jpeg', magic: [0xff, 0xd8, 0xff] },
  { format: 'webp', magic: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"; WEBP is confirmed further below.
  { format: 'gif', magic: [0x47, 0x49, 0x46, 0x38] },
];

/** True when the bytes start with a signature this endpoint accepts — ignores whatever the client claimed in Content-Type or the filename. */
function looksLikeAcceptedImage(bytes: Uint8Array): boolean {
  for (const { format, magic } of IMAGE_SIGNATURES) {
    if (!magic.every((byte, index) => bytes[index] === byte)) continue;

    // RIFF is a container format WAV/AVI also use — only bytes 8-11
    // spelling "WEBP" confirm this specific RIFF file is actually an
    // image, so a non-image RIFF file is correctly rejected rather than
    // passed through to sharp as if it were one.
    if (format === 'webp') {
      return bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    }
    return true;
  }
  return false;
}

export interface UploadedAvatar {
  url: string;
}

/**
 * Validates, converts to WebP, and stores an avatar upload, returning the
 * public URL the caller then passes to `updateProfile`'s own `avatar`
 * field — this function only ever writes the file and hands back where it
 * landed; it never touches the `profiles` table itself, so uploading an
 * image and actually setting it as your avatar are two explicit steps, and
 * an upload that's never confirmed by a following PATCH just sits as an
 * orphaned file rather than silently becoming your avatar.
 */
export async function uploadAvatar(fileData: ArrayBuffer): Promise<UploadedAvatar> {
  if (fileData.byteLength === 0) {
    throw new UnsupportedMediaTypeError('The uploaded file is empty.');
  }

  if (fileData.byteLength > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError(
      `Images must be ${String(MAX_UPLOAD_BYTES / (1024 * 1024))}MB or smaller.`,
    );
  }

  const bytes = new Uint8Array(fileData);
  if (!looksLikeAcceptedImage(bytes)) {
    throw new UnsupportedMediaTypeError('Only PNG, JPEG, WebP and GIF images are accepted.');
  }

  let webp: Buffer;
  try {
    webp = await convertToWebp(bytes);
  } catch {
    // A file that passed the magic-number check but that sharp still can't
    // decode (truncated, corrupt, or a byte sequence that only coincidentally
    // matched a signature) is the same class of problem as an unrecognized
    // format from the caller's point of view.
    throw new UnsupportedMediaTypeError('This file could not be read as an image.');
  }

  const config = env();
  const filename = `${randomUUID()}.webp`;

  await mkdir(config.CDN_UPLOAD_ROOT, { recursive: true });
  await writeFile(join(config.CDN_UPLOAD_ROOT, filename), webp);

  return { url: `${config.CDN_URL}/${filename}` };
}
