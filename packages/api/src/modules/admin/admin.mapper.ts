import type {
  AdminAnimeDto,
  AdminCommentDto,
  AdminSanctionDto,
  AdminUserDto,
} from '@playanime/contracts';
import type { AdminRepository } from '@playanime/database';

type UserRow = Awaited<ReturnType<AdminRepository['listUsers']>>[number];
type AnimeRow = Awaited<ReturnType<AdminRepository['listAnime']>>[number];
type CommentRow = Awaited<ReturnType<AdminRepository['listComments']>>[number];
type SanctionRow = Awaited<ReturnType<AdminRepository['sanctions']>>[number];

/**
 * Row-to-DTO mapping for the admin surface.
 *
 * These DTOs deliberately carry fields no public response may: an email
 * address, a suspension reason, a reporter count. The mapping is explicit for
 * the usual reason, and the separation from the public mappers is what makes it
 * impossible to reach one of these shapes from an unguarded route by accident.
 */

export function toAdminUser(row: UserRow): AdminUserDto {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    avatar: row.avatar,
    role: row.role,
    // Exposed as a boolean: when it was verified is of no use to the console.
    emailVerified: row.emailVerifiedAt !== null,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspendedUntil: row.suspendedUntil?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminAnime(row: AnimeRow): AdminAnimeDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.titleRomaji,
    format: row.format,
    status: row.status,
    seasonYear: row.seasonYear,
    episodeCount: row.episodeCount,
    actualEpisodeCount: row.actualEpisodeCount,
    sourceCount: row.sourceCount,
    isAdult: row.isAdult,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminComment(row: CommentRow): AdminCommentDto {
  return {
    id: row.id,
    body: row.body,
    animeId: row.animeId,
    animeTitle: row.animeTitle,
    episodeId: row.episodeId,
    authorUserId: row.authorUserId,
    authorUsername: row.authorUsername,
    rating: row.rating,
    hasSpoilers: row.hasSpoilers,
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    openReportCount: row.openReportCount,
    removedAt: row.removedAt?.toISOString() ?? null,
    removalReason: row.removalReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminSanction(row: SanctionRow): AdminSanctionDto {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    reason: row.reason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    issuedByUsername: row.issuedByUsername,
    liftedAt: row.liftedAt?.toISOString() ?? null,
    liftedByUsername: row.liftedByUsername,
    createdAt: row.createdAt.toISOString(),
  };
}
