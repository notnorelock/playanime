import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '@playanime/config';
import { AVATAR_SIZES, convertToWebp, generateAvatarSizes, type AvatarVariants } from '@playanime/importer';
import { AvatarRepository, db, type AvatarUploadRow } from '@playanime/database';
import { NotFoundError, PayloadTooLargeError, UnsupportedMediaTypeError } from '@playanime/shared';
import type { AvatarHistoryItem, AvatarSizes, AvatarUploadResponse } from '@playanime/contracts';
import { logger } from '../../plugins/error-handler.js';

/**
 * Avatar uploads — Discord-style: per-user nested storage
 * (`avatars/<userId>/<contentHash>_<size>.webp`), every upload kept in
 * history until the user deletes it themselves, four pre-generated size
 * variants per upload, and a magic-byte-checked upload pipeline unchanged
 * from before (see `looksLikeAcceptedImage`).
 *
 * The CDN (`services/cdn`) needs no awareness of any of this — it is a
 * plain static file server over `CDN_UPLOAD_ROOT`, and nested paths already
 * work with zero changes there. Every write happens here; the CDN only
 * ever serves what this module already wrote.
 */

const repository = new AvatarRepository(db());

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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

function avatarDirectory(userId: string): string {
  return join(env().CDN_UPLOAD_ROOT, 'avatars', userId);
}

function sizeFilename(contentHash: string, size: number): string {
  return `${contentHash}_${String(size)}.webp`;
}

function sizeUrl(userId: string, contentHash: string, size: number): string {
  return `${env().CDN_URL}/avatars/${userId}/${sizeFilename(contentHash, size)}`;
}

function toSizes(userId: string, contentHash: string): AvatarSizes {
  return {
    '64': sizeUrl(userId, contentHash, 64),
    '128': sizeUrl(userId, contentHash, 128),
    '256': sizeUrl(userId, contentHash, 256),
    '512': sizeUrl(userId, contentHash, 512),
  };
}

/** The largest generated size — what `avatarUrl`/`profiles.avatarUrl` denormalizes to. */
const LARGEST_AVATAR_SIZE = 512 satisfies (typeof AVATAR_SIZES)[number];

function baseUrl(userId: string, contentHash: string): string {
  return sizeUrl(userId, contentHash, LARGEST_AVATAR_SIZE);
}

async function writeVariants(userId: string, contentHash: string, variants: AvatarVariants): Promise<void> {
  const dir = avatarDirectory(userId);
  await mkdir(dir, { recursive: true });
  await Promise.all(
    variants.variants.map((variant) => writeFile(join(dir, sizeFilename(contentHash, variant.size)), variant.bytes)),
  );
}

/** Removes one upload's 4 size files from disk. Never throws — a failed filesystem delete must not surface as an API error when the DB row is already soft-deleted (see softDelete's own transaction). */
async function deleteAvatarFiles(userId: string, contentHash: string): Promise<void> {
  const dir = avatarDirectory(userId);
  await Promise.all(
    AVATAR_SIZES.map(async (size) => {
      try {
        await rm(join(dir, sizeFilename(contentHash, size)), { force: true });
      } catch (cause: unknown) {
        logger.error(`Failed to delete avatar variant ${sizeFilename(contentHash, size)}`, cause, {
          module: 'media',
          userId,
        });
      }
    }),
  );
}

/**
 * Deletes a user's entire avatar directory — called on account deletion.
 * Best-effort and never throws: this always runs after the account's DB
 * transaction has already committed (see profiles.service.ts), and an
 * orphaned directory keyed by a now-anonymized user id is a disk-cleanup
 * nit, not a data-exposure risk, so a failure here must never look like
 * the account deletion itself failed.
 */
export async function deleteUserAvatarDirectory(userId: string): Promise<void> {
  try {
    await rm(avatarDirectory(userId), { recursive: true, force: true });
  } catch (cause: unknown) {
    logger.error('Failed to delete a user\'s avatar directory', cause, { module: 'media', userId });
  }
}

function toUploadResponse(row: AvatarUploadRow): AvatarUploadResponse {
  return {
    id: row.id,
    url: baseUrl(row.userId, row.contentHash),
    sizes: toSizes(row.userId, row.contentHash),
    createdAt: row.createdAt.toISOString(),
  };
}

function toHistoryItem(row: AvatarUploadRow, isActive: boolean): AvatarHistoryItem {
  return {
    id: row.id,
    url: baseUrl(row.userId, row.contentHash),
    sizes: toSizes(row.userId, row.contentHash),
    isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Validates, converts to WebP, generates every size variant, stores an
 * avatar upload, and activates it as the caller's current avatar — all in
 * one call, unlike the old flat-file version of this endpoint, which
 * returned a bare URL the caller then had to PATCH /profile with
 * separately. A crop-then-upload UX has no reason to leave the result
 * unapplied, so this folds both steps together.
 *
 * `fileData` is expected to already be a cropped square (the frontend's
 * crop modal exports one) — this function does not itself crop or
 * center-crop; it only downscales the square it's given, once per size.
 */
export async function uploadAvatar(userId: string, fileData: ArrayBuffer): Promise<AvatarUploadResponse> {
  if (fileData.byteLength === 0) {
    throw new UnsupportedMediaTypeError('The uploaded file is empty.');
  }

  if (fileData.byteLength > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError(`Images must be ${String(MAX_UPLOAD_BYTES / (1024 * 1024))}MB or smaller.`);
  }

  const bytes = new Uint8Array(fileData);
  if (!looksLikeAcceptedImage(bytes)) {
    throw new UnsupportedMediaTypeError('Only PNG, JPEG, WebP and GIF images are accepted.');
  }

  let webp: Buffer;
  try {
    webp = await convertToWebp(bytes);
  } catch {
    throw new UnsupportedMediaTypeError('This file could not be read as an image.');
  }

  const contentHash = createHash('sha256').update(webp).digest('hex').slice(0, 32);

  // A pixel-identical re-upload reuses the existing row and files rather
  // than writing a duplicate — the partial unique index on
  // (userId, contentHash) exists specifically to make this safe under
  // concurrent uploads too, not just as an optimization here.
  const existing = await repository.findByUserAndHash(userId, contentHash);
  if (existing !== null) {
    await repository.activate(userId, existing.id, baseUrl(userId, existing.contentHash));
    return toUploadResponse(existing);
  }

  let variants: AvatarVariants;
  try {
    variants = await generateAvatarSizes(webp);
  } catch {
    throw new UnsupportedMediaTypeError('This file could not be read as an image.');
  }

  await writeVariants(userId, contentHash, variants);

  const row = await repository.create({
    userId,
    contentHash,
    storagePath: `avatars/${userId}/${contentHash}`,
    fileSizeBytes: webp.byteLength,
    width: variants.width,
    height: variants.height,
  });

  await repository.activate(userId, row.id, baseUrl(userId, contentHash));

  return toUploadResponse(row);
}

/** The caller's own upload history, newest first — external avatar URLs never appear here (see updateProfile's own handling). */
export async function getAvatarHistory(userId: string): Promise<AvatarHistoryItem[]> {
  const [rows, currentAvatarUploadId] = await Promise.all([
    repository.listForUser(userId),
    repository.currentUploadId(userId),
  ]);
  return rows.map((row) => toHistoryItem(row, row.id === currentAvatarUploadId));
}

/** Re-activates a past upload as the caller's current avatar. 404s (not 403) for someone else's upload id, same as this codebase's other per-user resource lookups. */
export async function activateAvatarUpload(userId: string, uploadId: string): Promise<AvatarUploadResponse> {
  const row = await repository.findById(uploadId, userId);
  if (row === null) {
    throw new NotFoundError('Nie znaleziono tego przesłanego avatara.');
  }

  await repository.activate(userId, row.id, baseUrl(userId, row.contentHash));
  return toUploadResponse(row);
}

/** Permanently deletes one of the caller's own uploads — the only pruning mechanism (history is otherwise kept forever). */
export async function deleteAvatarUpload(userId: string, uploadId: string): Promise<{ success: true }> {
  const row = await repository.findById(uploadId, userId);
  if (row === null) {
    throw new NotFoundError('Nie znaleziono tego przesłanego avatara.');
  }

  await repository.softDelete(uploadId, userId);
  await deleteAvatarFiles(userId, row.contentHash);

  return { success: true };
}
