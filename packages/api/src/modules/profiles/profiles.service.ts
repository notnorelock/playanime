import type {
  ActivityQuery,
  FollowListQuery,
  PreferencesUpdateBody,
  ProfileUpdateBody,
} from '@playanime/contracts';
import { db, ProfileRepository } from '@playanime/database';
import { clampPageSize, ConflictError, ErrorCode, NotFoundError } from '@playanime/shared';
import { toPreferences, toProfileSettings, toPublicProfile } from './profiles.mapper.js';

const repository = new ProfileRepository(db());

export async function getProfile(username: string, viewerId: string | null) {
  const row = await repository.findByUsername(username, viewerId);
  if (row === null) {
    throw new NotFoundError('Nie znaleziono tego profilu.', { code: ErrorCode.NOT_FOUND });
  }
  return toPublicProfile(row);
}

export async function updateProfile(userId: string, input: ProfileUpdateBody) {
  const row = await repository.updateProfile(userId, input);
  if (row === null) throw new Error('Profile update returned no row.');
  return toProfileSettings(row);
}

export async function getPreferences(userId: string) {
  const row = await repository.preferences(userId);
  if (row === null) throw new Error('Preferences row is missing.');
  return toPreferences(row);
}

export async function updatePreferences(userId: string, input: PreferencesUpdateBody) {
  const row = await repository.updatePreferences(userId, input);
  if (row === null) throw new Error('Preferences update returned no row.');
  return toPreferences(row);
}

export async function followProfile(userId: string, username: string, targetUsername: string) {
  const target = await getProfile(targetUsername, userId);
  if (target.userId === userId) throw new ConflictError('Nie możesz obserwować własnego profilu.');
  await repository.follow(userId, username, target.userId);
  return { success: true };
}

export async function unfollowProfile(userId: string, targetUsername: string) {
  const target = await getProfile(targetUsername, userId);
  await repository.unfollow(userId, target.userId);
  return { success: true };
}

export async function getActivity(username: string, query: ActivityQuery, viewerId: string | null) {
  const target = await getProfile(username, viewerId);
  const limit = clampPageSize(query.limit);
  const parsed = query.cursor === undefined ? null : new Date(query.cursor);
  const before = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const [libraryRows, ratingRows, commentRows] = await repository.activity(target.userId, limit, before);
  const rows = [
    ...libraryRows.map((row) => ({
      id: row.id,
      kind: 'library' as const,
      animeId: row.animeId,
      summary: `${row.title}: ${row.status}`,
      occurredAt: row.occurredAt,
    })),
    ...ratingRows.map((row) => ({
      id: row.id,
      kind: 'rating' as const,
      animeId: row.animeId,
      summary: `${row.title}: ${String(row.score)}/10`,
      occurredAt: row.occurredAt,
    })),
    ...commentRows.map((row) => ({
      id: row.id,
      kind: 'comment' as const,
      animeId: row.animeId,
      summary: `Komentarz do: ${row.title}`,
      occurredAt: row.occurredAt,
    })),
  ]
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
    .slice(0, limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
    nextCursor: hasMore ? (pageRows.at(-1)?.occurredAt.toISOString() ?? null) : null,
    hasMore,
  };
}

export async function listFollows(
  username: string,
  relation: 'followers' | 'following',
  query: FollowListQuery,
  viewerId: string | null,
) {
  const target = await getProfile(username, viewerId);
  const limit = clampPageSize(query.limit);
  const rows = await repository.followUsernames(target.userId, relation, limit);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = await Promise.all(pageRows.map((row) => getProfile(row.username, viewerId)));
  return { items, nextCursor: null, hasMore };
}
