import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client/index.js';
import { avatarUploads, profiles } from '../schema/users.js';

export interface NewAvatarUploadInput {
  readonly userId: string;
  readonly contentHash: string;
  readonly storagePath: string;
  readonly fileSizeBytes: number;
  readonly width: number;
  readonly height: number;
}

export class AvatarRepository {
  constructor(private readonly db: Database) {}

  /** For the upload dedup check — a pixel-identical re-upload reuses this row instead of writing new files. */
  async findByUserAndHash(userId: string, contentHash: string) {
    const [row] = await this.db
      .select()
      .from(avatarUploads)
      .where(
        and(eq(avatarUploads.userId, userId), eq(avatarUploads.contentHash, contentHash), isNull(avatarUploads.deletedAt)),
      )
      .limit(1);
    return row ?? null;
  }

  /** Ownership-scoped — a caller can only ever look up their own uploads (activate/delete both rely on this returning null for someone else's row). */
  async findById(id: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(avatarUploads)
      .where(and(eq(avatarUploads.id, id), eq(avatarUploads.userId, userId), isNull(avatarUploads.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async listForUser(userId: string) {
    return this.db
      .select()
      .from(avatarUploads)
      .where(and(eq(avatarUploads.userId, userId), isNull(avatarUploads.deletedAt)))
      .orderBy(desc(avatarUploads.createdAt));
  }

  /** Which upload (if any) `profiles.avatarUrl` currently mirrors for this user — null when unset or pointed at an external URL. */
  async currentUploadId(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ currentAvatarUploadId: profiles.currentAvatarUploadId })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return row?.currentAvatarUploadId ?? null;
  }

  async create(input: NewAvatarUploadInput) {
    const [row] = await this.db
      .insert(avatarUploads)
      .values({
        userId: input.userId,
        contentHash: input.contentHash,
        storagePath: input.storagePath,
        fileSizeBytes: input.fileSizeBytes,
        width: input.width,
        height: input.height,
      })
      .returning();
    if (row === undefined) throw new Error('Avatar upload insert returned no row.');
    return row;
  }

  /** Points `profiles.currentAvatarUploadId`/`avatarUrl` at this upload — the one place "which avatar is active" is actually decided. */
  async activate(userId: string, uploadId: string, url: string): Promise<void> {
    await this.db
      .update(profiles)
      .set({ currentAvatarUploadId: uploadId, avatarUrl: url })
      .where(eq(profiles.userId, userId));
  }

  /**
   * Soft-deletes an upload. If it was the caller's active avatar, the
   * pointer is cleared to null rather than falling back to a previous
   * upload — an explicit, later "activate" is required, matching "kept
   * until the user deletes it themselves" (no silent reassignment).
   */
  async softDelete(id: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(avatarUploads)
        .set({ deletedAt: new Date() })
        .where(and(eq(avatarUploads.id, id), eq(avatarUploads.userId, userId)));

      await tx
        .update(profiles)
        .set({ currentAvatarUploadId: null, avatarUrl: null })
        .where(and(eq(profiles.userId, userId), eq(profiles.currentAvatarUploadId, id)));
    });
  }
}
