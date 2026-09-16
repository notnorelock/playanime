import type {
  OwnedSourceListResponse,
  SourceBatchResultItem,
  SourceBatchSubmissionRequest,
  SourceBatchSubmissionResponse,
  SourceUpdateBody,
} from '@playanime/contracts';
import { CatalogueRepository, db } from '@playanime/database';
import { AppError, AuthorizationError, ErrorCode, NotFoundError, ValidationError } from '@playanime/shared';
import { submitSource } from '../sources/sources.service.js';
import type { AuthoringContext } from './permissions.js';

/**
 * Source authoring.
 *
 * An episode carries many sources by design — the same release is routinely
 * mirrored across providers, and a viewer picks between them in the player. The
 * data model already supported that; what was missing was any way to add one.
 *
 * Every source still records a rights attestation verbatim, whoever submits it.
 * What trust changes is visibility, not the record: a verified group's source
 * is live at once, an unverified submission waits for a moderator, and both are
 * equally answerable to a later complaint.
 */

const repository = new CatalogueRepository(db());

/**
 * Submits several sources for one episode.
 *
 * Partial success is the normal outcome and is reported per URL rather than
 * failing the batch: one dead mirror among five should not discard the four
 * that parsed. Each row is written independently, so an accepted source is
 * never rolled back by a later rejection.
 */
export async function submitSourceBatch(
  episodeId: string,
  input: SourceBatchSubmissionRequest,
  context: AuthoringContext,
  ipAddress: string,
): Promise<SourceBatchSubmissionResponse> {
  // Re-checked here as well as in the contract: this is a legal record, and a
  // caller reaching the service directly must not be able to skip it.
  const attested: unknown = input.rightsAttested;
  if (attested !== true) {
    throw new ValidationError('Musisz potwierdzić posiadanie praw do tych źródeł.', [
      { path: 'rightsAttested', message: 'Wymagane potwierdzenie praw.' },
    ]);
  }

  const results: SourceBatchResultItem[] = [];

  for (const source of input.sources) {
    try {
      const created = await submitSource(
        episodeId,
        {
          url: source.url,
          kind: source.kind,
          rightsAttested: true,
          ...(source.audioLanguage === undefined ? {} : { audioLanguage: source.audioLanguage }),
          ...(source.subtitleLanguage === undefined
            ? {}
            : { subtitleLanguage: source.subtitleLanguage }),
          ...(source.qualityHint === undefined ? {} : { qualityHint: source.qualityHint }),
          ...(source.note === undefined ? {} : { note: source.note }),
        },
        {
          userId: context.userId,
          ipAddress,
          groupId: context.groupId,
          publishImmediately: context.publishesImmediately,
        },
      );

      results.push({
        url: source.url,
        accepted: true,
        id: created.id,
        provider: created.provider,
        status: created.status,
      });
    } catch (cause: unknown) {
      /*
       * An expected rejection — a blocked domain, a duplicate, an unsupported
       * provider — is reported against its URL. Anything else is a defect and
       * is rethrown rather than flattened into a per-item message.
       */
      if (!AppError.is(cause)) throw cause;

      results.push({
        url: source.url,
        accepted: false,
        error: cause.message,
      });
    }
  }

  const acceptedCount = results.filter((result) => result.accepted).length;

  if (acceptedCount === 0) {
    // Every URL failed: report the first reason rather than a success envelope
    // full of errors, so the client surfaces something actionable.
    const first = results.find((result) => !result.accepted);
    throw new ValidationError(first?.error ?? 'Nie udało się dodać żadnego źródła.', [
      { path: 'sources', message: first?.error ?? 'Brak prawidłowych źródeł.' },
    ]);
  }

  return {
    episodeId,
    results,
    acceptedCount,
    publishedImmediately: context.publishesImmediately,
  };
}

/**
 * Every source on an episode, including rows viewers cannot see.
 *
 * Restricted to people who can act on them: a submitter needs to know why their
 * pending source has not appeared, but the moderation status and notes are not
 * public information.
 */
export async function listOwnedSources(
  episodeId: string,
  context: AuthoringContext,
): Promise<OwnedSourceListResponse> {
  const episode = await repository.findEpisode(episodeId);

  if (episode === null) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }

  const rows = await repository.listSourcesForEditing(episodeId);

  /*
   * A non-staff caller sees their own rows and their group's, and nothing else.
   *
   * Active sources are already public through the ordinary listing, so nothing
   * is hidden that a viewer could otherwise see — what this restricts is the
   * moderation status and notes attached to someone else's submission.
   */
  const visible = context.isStaff
    ? rows
    : rows.filter(
        (row) =>
          row.submittedByUserId === context.userId ||
          (context.groupId !== null && row.submittedByGroupId === context.groupId),
      );

  return {
    episodeId,
    sources: visible.map((row) => ({
      id: row.id,
      provider: row.provider,
      displayHost: hostOf(row.canonicalUrl, row.provider),
      kind: row.kind,
      audioLanguage: row.audioLanguage,
      subtitleLanguage: row.subtitleLanguage,
      qualityHint: row.qualityHint,
      isVerified: row.isVerified,
      canEmbed: true,
      availability: row.availability,
      addedAt: row.createdAt.toISOString(),
      status: row.status,
      canonicalUrl: row.canonicalUrl,
      moderationNote: row.moderationNote,
      submittedByUsername: row.submittedByUsername,
      groupName: row.groupName,
    })),
  };
}

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return fallback;
  }
}

/** Loads a source and checks the caller may modify it. */
async function requireOwnedSource(sourceId: string, context: AuthoringContext) {
  const source = await repository.findSource(sourceId);

  if (source === null) {
    throw new NotFoundError('Nie znaleziono tego źródła.', { code: ErrorCode.SOURCE_NOT_FOUND });
  }

  if (context.isStaff) return source;

  const ownedByUser = source.submittedByUserId === context.userId;
  const ownedByGroup =
    context.groupId !== null && source.submittedByGroupId === context.groupId;

  if (!ownedByUser && !ownedByGroup) {
    throw new AuthorizationError('Nie możesz modyfikować tego źródła.', {
      code: ErrorCode.FORBIDDEN,
    });
  }

  return source;
}

/**
 * Edits a source's metadata.
 *
 * Only the language and quality hints — never the URL. Changing the target of
 * an approved source would let a moderated resource be swapped for an
 * unmoderated one while keeping its approval, so a different URL means a new
 * submission.
 */
export async function updateOwnedSource(
  sourceId: string,
  input: SourceUpdateBody,
  context: AuthoringContext,
) {
  await requireOwnedSource(sourceId, context);

  const row = await repository.updateSource(sourceId, input);
  if (row === null) throw new NotFoundError('Nie znaleziono tego źródła.');

  return { id: row.id };
}

/** Withdraws a source. The row is retained so the audit trail survives. */
export async function withdrawOwnedSource(sourceId: string, context: AuthoringContext) {
  await requireOwnedSource(sourceId, context);

  const row = await repository.withdrawSource(sourceId);
  if (row === null) throw new NotFoundError('Nie znaleziono tego źródła.');

  return { success: true };
}
