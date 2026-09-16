import {
  TranslatorRole,
  UserRole,
  hasAtLeastRole,
  hasAtLeastTranslatorRole,
  type CataloguePermissions,
} from '@playanime/contracts';
import { TranslatorRepository, db } from '@playanime/database';
import { AuthorizationError, ErrorCode } from '@playanime/shared';
import type { RequestSession } from '../../plugins/session.js';

/**
 * Who may author what in the catalogue.
 *
 * This is the single place the rules live. Every authoring endpoint resolves
 * permissions through here rather than re-deriving them, because the rules
 * combine two independent hierarchies — the platform role and membership of a
 * translator group — and duplicating that combination is how the two drift
 * apart.
 *
 * The decision a caller most needs is `sourcesPublishImmediately`: a source
 * from a trusted submitter goes live, and everyone else's queues for review.
 * Trust here means a **platform-verified** group, not merely any group — anyone
 * can create a group, so group membership alone would make moderation optional.
 */

const translators = new TranslatorRepository(db());

export interface AuthoringContext {
  readonly userId: string;
  readonly role: UserRole;
  /** Group the caller is acting for, already verified as one they belong to. */
  readonly groupId: string | null;
  /** Whether that group is platform-verified. */
  readonly groupIsVerified: boolean;
  readonly isStaff: boolean;
  /** Whether a source this caller submits skips the moderation queue. */
  readonly publishesImmediately: boolean;
}

/** Groups the user belongs to that are live and not suspended. */
async function authoringGroups(userId: string) {
  const rows = await translators.groupsForUser(userId);

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    isVerified: row.verifiedAt !== null,
    role: row.role,
  }));
}

/**
 * Describes what the current user may do.
 *
 * Returned to the client so it can render the right controls. It is a hint for
 * presentation: every endpoint decides independently, and a client that ignores
 * this receives a 403 rather than a broken write.
 */
export async function resolvePermissions(
  session: RequestSession | null,
): Promise<CataloguePermissions> {
  if (session === null) {
    return {
      canCreateAnime: false,
      canEditAnyAnime: false,
      canCreateEpisodes: false,
      canSubmitSources: false,
      sourcesPublishImmediately: false,
      canModerate: false,
      groups: [],
    };
  }

  const isStaff = hasAtLeastRole(session.user.role, UserRole.MODERATOR);
  const groups = await authoringGroups(session.user.id);

  /*
   * Authoring requires a verified email, exactly as source submission already
   * does. A title is a public, permanent record; creating one from a throwaway
   * account is how catalogue vandalism starts.
   */
  const verifiedEmail = session.user.emailVerified;

  // Editors and above curate a group's catalogue work; a plain member does not.
  const canAuthorForGroup = groups.some((group) =>
    hasAtLeastTranslatorRole(group.role, TranslatorRole.EDITOR),
  );

  const inVerifiedGroup = groups.some(
    (group) => group.isVerified && hasAtLeastTranslatorRole(group.role, TranslatorRole.EDITOR),
  );

  return {
    canCreateAnime: isStaff || (verifiedEmail && canAuthorForGroup),
    // Editing any title — not only ones you added — stays with staff.
    canEditAnyAnime: isStaff,
    canCreateEpisodes: isStaff || (verifiedEmail && canAuthorForGroup),
    canSubmitSources: isStaff || verifiedEmail,
    sourcesPublishImmediately: isStaff || inVerifiedGroup,
    canModerate: isStaff,
    groups: groups.map((group) => ({
      id: group.id,
      slug: group.slug,
      name: group.name,
      isVerified: group.isVerified,
    })),
  };
}

/**
 * Resolves the authoring context for a write, verifying the claimed group.
 *
 * A caller supplies a `groupId` to credit; this confirms they actually belong
 * to it at a rank that may author. Trusting the id would let anyone attribute
 * work to a verified group — and, through `publishesImmediately`, borrow its
 * right to bypass moderation.
 */
export async function requireAuthoring(
  session: RequestSession | null,
  groupId: string | null | undefined,
  options: { requireGroupForNonStaff?: boolean } = {},
): Promise<AuthoringContext> {
  if (session === null) {
    throw new AuthorizationError('Musisz być zalogowany, aby wykonać tę akcję.', {
      code: ErrorCode.UNAUTHENTICATED,
    });
  }

  const isStaff = hasAtLeastRole(session.user.role, UserRole.MODERATOR);

  if (!isStaff && !session.user.emailVerified) {
    throw new AuthorizationError('Potwierdź swój adres e-mail, aby edytować katalog.', {
      code: ErrorCode.EMAIL_NOT_VERIFIED,
    });
  }

  let resolvedGroupId: string | null = null;
  let groupIsVerified = false;

  if (groupId != null) {
    const membership = await translators.membership(groupId, session.user.id);

    if (membership === null || !hasAtLeastTranslatorRole(membership.role, TranslatorRole.EDITOR)) {
      throw new AuthorizationError('Nie możesz działać w imieniu tej grupy.', {
        code: ErrorCode.FORBIDDEN,
      });
    }

    const group = await translators.findById(groupId);
    if (group === null) {
      throw new AuthorizationError('Ta grupa jest niedostępna.', { code: ErrorCode.FORBIDDEN });
    }

    resolvedGroupId = group.id;
    groupIsVerified = group.verifiedAt !== null;
  } else if (!isStaff && options.requireGroupForNonStaff === true) {
    // Catalogue writes by non-staff are always on behalf of a group, so the
    // work is attributable to someone answerable for it.
    throw new AuthorizationError('Wybierz grupę, w imieniu której działasz.', {
      code: ErrorCode.FORBIDDEN,
    });
  }

  return {
    userId: session.user.id,
    role: session.user.role,
    groupId: resolvedGroupId,
    groupIsVerified,
    isStaff,
    publishesImmediately: isStaff || groupIsVerified,
  };
}
