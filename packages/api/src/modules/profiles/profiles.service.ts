import type {
  ActivityQuery,
  DeleteAccountBody,
  FollowListQuery,
  LibraryQuery,
  MySanctionsResponse,
  PreferencesUpdateBody,
  ProfileUpdateBody,
} from '@playanime/contracts';
import { AdminRepository, db, LibraryRepository, ProfileRepository } from '@playanime/database';
import { fakeVerifyPassword, verifyPassword } from '@playanime/auth';
import { AuthenticationError, ConflictError, ErrorCode, clampPageSize, NotFoundError } from '@playanime/shared';
import { deleteUserAvatarDirectory } from '../media/media.service.js';
import { toLibraryEntry } from '../library/library.mapper.js';
import { toMySanction, toPreferences, toProfileSettings, toPublicProfile } from './profiles.mapper.js';

const repository = new ProfileRepository(db());
const libraryRepository = new LibraryRepository(db());
// AdminRepository.sanctions(userId) has no notion of "admin" vs "self" —
// it just returns one user's sanction history; this module reuses it
// directly (self-scoped by always passing the caller's own id) rather
// than duplicating the query. See MySanction's own doc comment in
// @playanime/contracts for why the RESPONSE shape is still separate from
// AdminSanctionDto.
const adminRepository = new AdminRepository(db());

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

export async function getMySanctions(userId: string): Promise<MySanctionsResponse> {
  const rows = await adminRepository.sanctions(userId);
  return { sanctions: rows.map(toMySanction) };
}

export async function updatePreferences(userId: string, input: PreferencesUpdateBody) {
  const row = await repository.updatePreferences(userId, input);
  if (row === null) throw new Error('Preferences update returned no row.');
  return toPreferences(row);
}

/**
 * Deletes the caller's own account.
 *
 * Self-service only, gated by re-entering the password — the same
 * re-authentication this app already asks for before other serious account
 * actions, and the reason a failed attempt still runs `fakeVerifyPassword`
 * (matching the login path's own timing-equalization, so a caller cannot
 * distinguish "wrong password" from "no password set" by response time).
 * An OAuth-only account has no password to confirm with, so that check is
 * skipped for it — there's nothing here it could protect against that the
 * session cookie itself doesn't already gate.
 *
 * `ProfileRepository.deleteAccount` does the actual scrub; see its own doc
 * comment for what is and is not touched.
 */
export async function deleteMyAccount(userId: string, input: DeleteAccountBody): Promise<{ success: true }> {
  const storedHash = await repository.passwordHash(userId);

  if (storedHash !== null) {
    const valid = input.password === undefined ? false : await verifyPassword(input.password, storedHash);
    if (!valid) {
      if (input.password === undefined) await fakeVerifyPassword();
      throw new AuthenticationError('Nieprawidłowe hasło.', { code: ErrorCode.INVALID_CREDENTIALS });
    }
  }

  await repository.deleteAccount(userId);

  // Best-effort, after the DB transaction has already committed — a failed
  // filesystem delete must never look like account deletion itself failed.
  // See deleteUserAvatarDirectory's own doc comment.
  await deleteUserAvatarDirectory(userId);

  return { success: true };
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

  // Each kind carries exactly the fields its own contract needs; there is no
  // shared "summary" for the client to fall back on formatting itself, by
  // design — that is what made the previous version bake Polish text and a
  // fixed layout into the API response.
  const rows = [
    ...libraryRows.map((row) => ({
      id: row.id,
      kind: 'library' as const,
      seriesId: row.seriesId,
      seriesSlug: row.seriesSlug,
      seriesTitle: row.seriesTitle,
      status: row.status,
      occurredAt: row.occurredAt,
    })),
    ...ratingRows.map((row) => ({
      id: row.id,
      kind: 'rating' as const,
      seriesId: row.seriesId,
      seriesSlug: row.seriesSlug,
      seriesTitle: row.seriesTitle,
      score: row.score,
      occurredAt: row.occurredAt,
    })),
    ...commentRows.map((row) => ({
      id: row.id,
      kind: 'comment' as const,
      seriesId: row.seriesId,
      seriesSlug: row.seriesSlug,
      seriesTitle: row.seriesTitle,
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

/**
 * A profile's library, as seen by a visitor: only entries the owner has not
 * marked private. The owner's own view (`GET /library`, used on `/profile/me`)
 * goes through a different, unfiltered endpoint — this one is never used for
 * that.
 */
export async function getPublicLibrary(username: string, viewerId: string | null, query: LibraryQuery) {
  const target = await getProfile(username, viewerId);
  const limit = clampPageSize(query.limit);
  const parsed = query.cursor === undefined ? null : new Date(query.cursor);
  const before = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const rows = await libraryRepository.list(target.userId, query.status, limit, before, true);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(toLibraryEntry),
    nextCursor: hasMore ? (pageRows.at(-1)?.updatedAt.toISOString() ?? null) : null,
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
