import {
  TranslatorRole,
  hasAtLeastTranslatorRole,
  type TranslatorAnimeUpsertBody,
  type TranslatorApplicationCreateBody,
  type TranslatorApplicationDecisionBody,
  type TranslatorGroupCreateBody,
  type TranslatorGroupDetail,
  type TranslatorGroupQuery,
  type TranslatorGroupUpdateBody,
  type TranslatorMemberInviteBody,
  type TranslatorMemberUpsertBody,
} from '@playanime/contracts';
import { CatalogueRepository, TranslatorRepository, db } from '@playanime/database';
import {
  AuthorizationError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  ValidationError,
  clampPageSize,
  slugify,
} from '@playanime/shared';
import {
  toAnimeTranslatorCredit,
  toApplicationDto,
  toGroupSummary,
  toMemberDto,
  toTitleDto,
} from './translators.mapper.js';

/**
 * Fansub groups.
 *
 * The authorization model here is deliberately not the platform's role model: a
 * group is administered by its own leaders, and PlayAnime staff intervene only
 * through the audited moderation path in the admin module. `requireLeader` is
 * therefore about group membership, not about `UserRole`.
 */

const repository = new TranslatorRepository(db());
const catalogueRepository = new CatalogueRepository(db());

/** How many groups one user may lead. Prevents slug and name squatting. */
const MAX_GROUPS_PER_USER = 5;

/** Parses the tri-state boolean query parameters arrive as. */
function asBoolean(value: boolean | 'true' | 'false' | undefined): boolean {
  return value === true || value === 'true';
}

/**
 * Derives a unique slug from the group name.
 *
 * The client does not choose it: letting one pick a slug invites squatting on
 * the slugs of well-known groups before they register.
 */
async function deriveSlug(name: string): Promise<string> {
  const base = slugify(name);

  if (base.length === 0) {
    throw new ValidationError('Nazwa grupy musi zawierać litery lub cyfry.', [
      { path: 'name', message: 'Nieprawidłowa nazwa.' },
    ]);
  }

  if (!(await repository.slugTaken(base))) return base;

  // A numeric suffix rather than a random one: a human-readable slug survives
  // being copied into a chat message.
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base.slice(0, 92)}-${String(suffix)}`;
    if (!(await repository.slugTaken(candidate))) return candidate;
  }

  throw new ConflictError('Nie udało się utworzyć unikalnego adresu dla tej nazwy.');
}

/** Loads a group by slug or throws. */
async function requireGroup(slug: string) {
  const group = await repository.findBySlug(slug);
  if (group === null) {
    throw new NotFoundError('Nie znaleziono tej grupy.', { code: ErrorCode.NOT_FOUND });
  }
  return group;
}

/**
 * Requires the caller to hold at least `role` inside the group.
 *
 * Returns the membership so callers do not query for it twice. Does not
 * distinguish "not a member" from "insufficient role" in the message, for the
 * same reason the ownership guard does not: the difference is information.
 */
async function requireGroupRole(groupId: string, userId: string, role: TranslatorRole) {
  const membership = await repository.membership(groupId, userId);

  if (membership === null || !hasAtLeastTranslatorRole(membership.role, role)) {
    throw new AuthorizationError('Nie masz uprawnień w tej grupie.', {
      code: ErrorCode.FORBIDDEN,
    });
  }

  return membership;
}

const requireLeader = (groupId: string, userId: string) =>
  requireGroupRole(groupId, userId, TranslatorRole.LEADER);

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listGroups(query: TranslatorGroupQuery) {
  const limit = clampPageSize(query.limit);
  const parsed = query.cursor === undefined ? null : new Date(query.cursor);
  const before = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;

  const rows = await repository.list(
    {
      search: query.search,
      recruitingOnly: asBoolean(query.recruitingOnly),
      verifiedOnly: asBoolean(query.verifiedOnly),
    },
    limit,
    before,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: pageRows.map(toGroupSummary),
    nextCursor: hasMore ? (pageRows.at(-1)?.updatedAt.toISOString() ?? null) : null,
    hasMore,
  };
}

export async function getGroup(slug: string, viewerId: string | null): Promise<TranslatorGroupDetail> {
  const group = await requireGroup(slug);

  const [members, titles, membership, pendingApplication] = await Promise.all([
    repository.members(group.id),
    repository.titles(group.id),
    viewerId === null ? null : repository.membership(group.id, viewerId),
    viewerId === null ? null : repository.pendingApplication(group.id, viewerId),
  ]);

  return {
    id: group.id,
    slug: group.slug,
    name: group.name,
    description: group.description,
    avatar:
      group.avatarUrl === null
        ? null
        : { url: group.avatarUrl, blurhash: null, width: null, height: null },
    banner:
      group.bannerUrl === null
        ? null
        : { url: group.bannerUrl, blurhash: null, width: null, height: null },
    websiteUrl: group.websiteUrl,
    discordUrl: group.discordUrl,
    isVerified: group.verifiedAt !== null,
    isRecruiting: group.isRecruiting,
    memberCount: group.memberCount,
    entryCount: group.entryCount,
    members: members.map(toMemberDto),
    titles: titles.map(toTitleDto),
    viewerRole: membership?.role ?? null,
    viewerHasPendingApplication: pendingApplication !== null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

/** Groups the caller belongs to, with their role in each. */
export async function listMyGroups(userId: string) {
  const rows = await repository.groupsForUser(userId);

  return rows.map((row) => ({
    ...toGroupSummary({ ...row, updatedAt: row.createdAt }),
    viewerRole: row.role,
  }));
}

/** Groups credited on a title, rendered on the title page. */
export async function listGroupsForAnime(animeId: string) {
  const rows = await repository.groupsForAnime(animeId);
  return rows.map(toAnimeTranslatorCredit);
}

/* -------------------------------------------------------------------------- */
/* Group lifecycle                                                             */
/* -------------------------------------------------------------------------- */

export async function createGroup(userId: string, input: TranslatorGroupCreateBody) {
  // A name collision is reported before a slug is derived, so the user gets the
  // actual reason rather than a surprising slug suffix.
  if (await repository.nameTaken(input.name)) {
    throw new ConflictError('Grupa o tej nazwie już istnieje.', {
      code: ErrorCode.ALREADY_EXISTS,
    });
  }

  const existing = await repository.groupsForUser(userId);
  if (existing.filter((row) => row.role === TranslatorRole.LEADER).length >= MAX_GROUPS_PER_USER) {
    throw new ConflictError(
      `Możesz prowadzić maksymalnie ${String(MAX_GROUPS_PER_USER)} grup.`,
      { code: ErrorCode.CONFLICT },
    );
  }

  const slug = await deriveSlug(input.name);
  const group = await repository.create(userId, slug, input);

  return getGroup(group.slug, userId);
}

export async function updateGroup(slug: string, userId: string, input: TranslatorGroupUpdateBody) {
  const group = await requireGroup(slug);
  await requireLeader(group.id, userId);

  await repository.update(group.id, input);
  return getGroup(slug, userId);
}

/**
 * Disbands a group.
 *
 * Soft delete: membership and title credits survive, so attribution on existing
 * sources does not silently vanish when a group closes.
 */
export async function deleteGroup(slug: string, userId: string) {
  const group = await requireGroup(slug);
  await requireLeader(group.id, userId);

  await repository.softDelete(group.id);
  return { success: true };
}

/* -------------------------------------------------------------------------- */
/* Membership                                                                  */
/* -------------------------------------------------------------------------- */

export async function inviteMember(slug: string, userId: string, input: TranslatorMemberInviteBody) {
  const group = await requireGroup(slug);
  await requireLeader(group.id, userId);

  const target = await repository.findMemberCandidate(input.username);
  if (target === null) {
    throw new NotFoundError('Nie znaleziono użytkownika o tej nazwie.', {
      code: ErrorCode.USER_NOT_FOUND,
    });
  }

  const added = await repository.addMember(
    group.id,
    target.id,
    input.role ?? TranslatorRole.MEMBER,
    input.creditNote ?? null,
    userId,
  );

  if (added === null) {
    throw new ConflictError('Ten użytkownik jest już członkiem grupy.', {
      code: ErrorCode.ALREADY_EXISTS,
    });
  }

  return getGroup(slug, userId);
}

export async function updateMember(
  slug: string,
  actorId: string,
  targetUserId: string,
  input: TranslatorMemberUpsertBody,
) {
  const group = await requireGroup(slug);
  await requireLeader(group.id, actorId);

  const target = await repository.membership(group.id, targetUserId);
  if (target === null) {
    throw new NotFoundError('Ten użytkownik nie należy do grupy.');
  }

  // Demoting the last leader would leave the group unadministrable, and no
  // in-product path could restore it.
  if (target.role === TranslatorRole.LEADER && input.role !== TranslatorRole.LEADER) {
    const leaders = await repository.leaderCount(group.id);
    if (leaders <= 1) {
      throw new ConflictError('Grupa musi mieć co najmniej jednego lidera.', {
        code: ErrorCode.CONFLICT,
      });
    }
  }

  await repository.updateMember(group.id, targetUserId, {
    role: input.role,
    ...(input.creditNote === undefined ? {} : { creditNote: input.creditNote }),
  });

  return getGroup(slug, actorId);
}

export async function removeMember(slug: string, actorId: string, targetUserId: string) {
  const group = await requireGroup(slug);

  // A member may always remove themselves; removing anyone else needs leadership.
  if (actorId !== targetUserId) await requireLeader(group.id, actorId);

  const target = await repository.membership(group.id, targetUserId);
  if (target === null) {
    throw new NotFoundError('Ten użytkownik nie należy do grupy.');
  }

  if (target.role === TranslatorRole.LEADER) {
    const leaders = await repository.leaderCount(group.id);
    if (leaders <= 1) {
      throw new ConflictError(
        'Grupa musi mieć co najmniej jednego lidera. Przekaż rolę przed odejściem.',
        { code: ErrorCode.CONFLICT },
      );
    }
  }

  await repository.removeMember(group.id, targetUserId);
  return { success: true };
}

/* -------------------------------------------------------------------------- */
/* Titles                                                                      */
/* -------------------------------------------------------------------------- */

export async function addTitle(slug: string, userId: string, input: TranslatorAnimeUpsertBody) {
  const group = await requireGroup(slug);
  // Editors curate the title list; it is not a leader-only action.
  await requireGroupRole(group.id, userId, TranslatorRole.EDITOR);

  const entry = await catalogueRepository.findEntryById(input.entryId);
  if (entry === null) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  await repository.addTitle(group.id, input);
  return getGroup(slug, userId);
}

export async function removeTitle(slug: string, userId: string, entryId: string) {
  const group = await requireGroup(slug);
  await requireGroupRole(group.id, userId, TranslatorRole.EDITOR);

  await repository.removeTitle(group.id, entryId);
  return { success: true };
}

/* -------------------------------------------------------------------------- */
/* Applications                                                                */
/* -------------------------------------------------------------------------- */

export async function applyToGroup(
  slug: string,
  userId: string,
  input: TranslatorApplicationCreateBody,
) {
  const group = await requireGroup(slug);

  if (!group.isRecruiting) {
    throw new ConflictError('Ta grupa nie prowadzi obecnie naboru.', {
      code: ErrorCode.CONFLICT,
    });
  }

  if ((await repository.membership(group.id, userId)) !== null) {
    throw new ConflictError('Należysz już do tej grupy.', { code: ErrorCode.ALREADY_EXISTS });
  }

  if ((await repository.pendingApplication(group.id, userId)) !== null) {
    throw new ConflictError('Masz już oczekujące zgłoszenie do tej grupy.', {
      code: ErrorCode.ALREADY_EXISTS,
    });
  }

  const row = await repository.createApplication(group.id, userId, input.message ?? null);
  if (row === null) throw new Error('Application insert returned no row.');

  return { id: row.id, status: row.status };
}

export async function listApplications(
  slug: string,
  userId: string,
  query: { cursor?: string | undefined; limit?: number | string | undefined; status?: string },
) {
  const group = await requireGroup(slug);
  await requireLeader(group.id, userId);

  const limit = clampPageSize(query.limit);
  const parsed = query.cursor === undefined ? null : new Date(query.cursor);
  const before = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;

  const rows = await repository.applications(group.id, query.status ?? 'pending', limit, before);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: pageRows.map(toApplicationDto),
    nextCursor: hasMore ? (pageRows.at(-1)?.createdAt.toISOString() ?? null) : null,
    hasMore,
  };
}

export async function decideApplication(
  slug: string,
  actorId: string,
  applicationId: string,
  input: TranslatorApplicationDecisionBody,
) {
  const group = await requireGroup(slug);
  await requireLeader(group.id, actorId);

  const application = await repository.findApplication(applicationId);
  // Scoped to this group: an application id alone must not let a leader of one
  // group decide another group's applications.
  if (application?.groupId !== group.id) {
    throw new NotFoundError('Nie znaleziono tego zgłoszenia.');
  }

  if (application.status !== 'pending') {
    throw new ConflictError('To zgłoszenie zostało już rozpatrzone.', {
      code: ErrorCode.CONFLICT,
    });
  }

  // A leader role cannot be granted through an application: promoting to leader
  // is a deliberate act on an existing member, not a side effect of accepting a
  // stranger's request.
  const requested = input.role ?? TranslatorRole.MEMBER;
  const role = requested === TranslatorRole.LEADER ? TranslatorRole.EDITOR : requested;

  const decided = await repository.decideApplication(
    applicationId,
    actorId,
    input.accept,
    role,
    { id: group.id, name: group.name, slug: group.slug },
    application.userId,
  );

  if (decided === null) {
    throw new ConflictError('To zgłoszenie zostało już rozpatrzone.', {
      code: ErrorCode.CONFLICT,
    });
  }

  return { id: decided.id, status: decided.status };
}

export async function withdrawApplication(userId: string, applicationId: string) {
  const row = await repository.withdrawApplication(applicationId, userId);
  if (row === null) {
    throw new NotFoundError('Nie znaleziono oczekującego zgłoszenia.');
  }
  return { success: true };
}
