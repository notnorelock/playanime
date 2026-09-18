import type {
  AnimeTranslatorCredit,
  EntrySummaryDto,
  TranslatorAnimeDto,
  TranslatorApplicationDto,
  TranslatorGroupSummary,
  TranslatorMemberDto,
} from '@playanime/contracts';
import type {
  AnimeTranslatorGroupRow,
  TranslatorApplicationListRow,
  TranslatorGroupListRow,
  TranslatorMemberListRow,
  TranslatorTitleRow,
} from '@playanime/database';

/**
 * Row-to-DTO mapping for translator groups.
 *
 * As everywhere else in this API, each exposed field is an explicit assignment.
 * Spreading a row would publish `suspension_reason` and `verified_by_user_id`
 * to every visitor the first time someone added them to the table.
 */

/** Verification is exposed as a boolean; who granted it and when are internal. */
function isVerified(verifiedAt: Date | null): boolean {
  return verifiedAt !== null;
}

export function toGroupSummary(row: TranslatorGroupListRow): TranslatorGroupSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    avatar:
      row.avatarUrl === null
        ? null
        : { url: row.avatarUrl, blurhash: null, width: null, height: null },
    isVerified: isVerified(row.verifiedAt),
    isRecruiting: row.isRecruiting,
    memberCount: row.memberCount,
    entryCount: row.entryCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMemberDto(row: TranslatorMemberListRow): TranslatorMemberDto {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatar: row.avatar,
    role: row.role,
    creditNote: row.creditNote,
    joinedAt: row.joinedAt.toISOString(),
  };
}

function toEntrySummary(row: TranslatorTitleRow): EntrySummaryDto {
  return {
    id: row.entryId,
    slug: row.slug,
    entryType: row.entryType,
    titles: {
      romaji: row.titleRomaji,
      english: row.titleEnglish,
      native: row.titleNative,
    },
    seasonNumber: row.seasonNumber,
    courNumber: row.courNumber,
    airingSeason: row.airingSeason,
    airingYear: row.airingYear,
    status: row.releaseStatus,
    episodeCount: row.episodeCount,
    poster:
      row.posterUrl === null
        ? null
        : {
            url: row.posterUrl,
            blurhash: row.posterBlurhash,
            width: row.posterWidth,
            height: row.posterHeight,
          },
    releaseOrder: null,
    chronologicalOrder: null,
    isMainEntry: true,
  };
}

export function toTitleDto(row: TranslatorTitleRow): TranslatorAnimeDto {
  return {
    entry: toEntrySummary(row),
    seriesSlug: row.seriesSlug,
    episodeRange: row.episodeRange,
    note: row.note,
    addedAt: row.addedAt.toISOString(),
  };
}

export function toAnimeTranslatorCredit(row: AnimeTranslatorGroupRow): AnimeTranslatorCredit {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    avatar:
      row.avatarUrl === null
        ? null
        : { url: row.avatarUrl, blurhash: null, width: null, height: null },
    isVerified: isVerified(row.verifiedAt),
    episodeRange: row.episodeRange,
  };
}

export function toApplicationDto(row: TranslatorApplicationListRow): TranslatorApplicationDto {
  return {
    id: row.id,
    groupId: row.groupId,
    groupName: row.groupName,
    groupSlug: row.groupSlug,
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatar: row.avatar,
    message: row.message,
    // The column is a varchar with a check constraint; the contract narrows it
    // to the literal union, and the constraint is what guarantees the cast.
    status: row.status as TranslatorApplicationDto['status'],
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
