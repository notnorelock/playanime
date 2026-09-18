import { and, eq, or, sql } from 'drizzle-orm';
import { ConflictError, ErrorCode, NotFoundError, now, ValidationError } from '@playanime/shared';
import {
  SourceStatus,
  type EpisodeSourceDto,
  type EpisodeSourceListResponse,
  type SourceSubmissionRequest,
  type SourceSubmissionResponse,
  RIGHTS_ATTESTATION_TEXT_PL,
} from '@playanime/contracts';
import { blockedResources, db, episodes, episodeSources, type Database } from '@playanime/database';
import {
  parseSubmittedUrl,
  providerRegistry,
  rankSources,
  type RankableSource,
} from '@playanime/external-media';

/**
 * Episode source listing and submission.
 *
 * PlayAnime stores the stable identity of a third-party resource — provider
 * plus resource id — and the moderation state governing whether viewers see it.
 * It does not store, and never returns, resolved playback URLs.
 */

/** Only approved sources are ever listed to a viewer. */
export async function listSources(
  episodeId: string,
  preferences: {
    preferredAudioLanguage: string | null;
    preferredSubtitleLanguage: string | null;
  },
  database: Database = db(),
): Promise<EpisodeSourceListResponse> {
  const rows = await database
    .select({
      id: episodeSources.id,
      provider: episodeSources.provider,
      canonicalUrl: episodeSources.canonicalUrl,
      kind: episodeSources.kind,
      audioLanguage: episodeSources.audioLanguage,
      subtitleLanguage: episodeSources.subtitleLanguage,
      qualityHint: episodeSources.qualityHint,
      isVerified: episodeSources.isVerified,
      availability: episodeSources.availability,
      priority: episodeSources.priority,
      failureCount: episodeSources.failureCount,
      createdAt: episodeSources.createdAt,
    })
    .from(episodeSources)
    .where(
      and(eq(episodeSources.episodeId, episodeId), eq(episodeSources.status, SourceStatus.ACTIVE)),
    );

  // Ranking happens server-side so the preferred provider order is
  // configuration, not a constant compiled into the frontend.
  const rankable: RankableSource[] = rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    isVerified: row.isVerified,
    availability: row.availability,
    audioLanguage: row.audioLanguage,
    subtitleLanguage: row.subtitleLanguage,
    qualityHint: row.qualityHint,
    priority: row.priority,
    failureCount: row.failureCount,
  }));

  const ranked = rankSources(
    rankable,
    {
      preferredAudioLanguage: preferences.preferredAudioLanguage as never,
      preferredSubtitleLanguage: preferences.preferredSubtitleLanguage as never,
    },
    providerRegistry,
  );

  const byId = new Map(rows.map((row) => [row.id, row]));

  const sources: EpisodeSourceDto[] = ranked.flatMap((entry) => {
    const row = byId.get(entry.id);
    if (row === undefined) return [];

    let displayHost: string = row.provider;
    try {
      displayHost = new URL(row.canonicalUrl).hostname.replace(/^www\./, '');
    } catch {
      // A malformed stored URL falls back to the provider name rather than
      // failing the whole listing.
    }

    return [
      {
        id: row.id,
        provider: row.provider,
        displayHost,
        kind: row.kind,
        audioLanguage: row.audioLanguage,
        subtitleLanguage: row.subtitleLanguage,
        qualityHint: row.qualityHint,
        isVerified: row.isVerified,
        canEmbed: providerRegistry.canEmbed(row.provider),
        availability: row.availability,
        addedAt: row.createdAt.toISOString(),
      },
    ];
  });

  return {
    episodeId,
    sources,
    recommendedSourceId: sources[0]?.id ?? null,
  };
}

/**
 * Accepts a user-submitted source.
 *
 * The submission enters moderation as `pending` and is invisible to viewers
 * until approved. Three gates run before the row is written: URL validation,
 * the block list, and duplicate detection.
 */
export interface SourceSubmitter {
  readonly userId: string;
  readonly ipAddress: string;
  /** Group credited for the source. Verified by the caller, not trusted here. */
  readonly groupId?: string | null;
  /**
   * Whether this submitter's sources skip moderation.
   *
   * True for staff and for members of a platform-verified group. The caller
   * resolves this — the service records the consequence, it does not decide
   * who is trusted.
   */
  readonly publishImmediately?: boolean;
  /**
   * Provenance for a source that did not originate from a human filling out
   * the submission form — a bulk importer, for instance. Merged into the
   * row's `metadata` column verbatim; display detail only, same as every
   * other value stored there, never a credential or signed URL. Omitted for
   * an ordinary form submission.
   */
  readonly metadata?: Record<string, unknown>;
}

export async function submitSource(
  episodeId: string,
  input: SourceSubmissionRequest,
  submitter: SourceSubmitter,
  database: Database = db(),
): Promise<SourceSubmissionResponse> {
  // Re-checked at runtime. The contract types this as the literal `true`, so
  // TypeScript treats the branch as dead — but this is a legal record, and a
  // caller reaching the service directly (a script, a future queue consumer,
  // a value that arrived as JSON) must not be able to skip the attestation.
  // Read through `unknown` so the check survives the narrowed type.
  const attested: unknown = input.rightsAttested;
  if (attested !== true) {
    throw new ValidationError('Musisz potwierdzić posiadanie praw do tego źródła.', [
      { path: 'rightsAttested', message: 'Wymagane potwierdzenie praw.' },
    ]);
  }

  const [episode] = await database
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);

  if (episode === undefined) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', { code: ErrorCode.EPISODE_NOT_FOUND });
  }

  // Rejects javascript:, data:, credentials, loopback and private hosts before
  // any provider sees the input.
  const url = parseSubmittedUrl(input.url);
  const parsed = providerRegistry.parse(url);

  // Refuse a resource or domain already blocked by moderation.
  const [blocked] = await database
    .select({ id: blockedResources.id })
    .from(blockedResources)
    .where(
      or(
        and(
          eq(blockedResources.provider, parsed.provider),
          eq(blockedResources.externalId, parsed.externalId),
        ),
        eq(blockedResources.domain, parsed.displayHost),
      ),
    )
    .limit(1);

  if (blocked !== undefined) {
    throw new ConflictError('To źródło zostało zablokowane i nie może zostać dodane.', {
      code: ErrorCode.CONFLICT,
    });
  }

  const [duplicate] = await database
    .select({ id: episodeSources.id, status: episodeSources.status })
    .from(episodeSources)
    .where(
      and(
        eq(episodeSources.episodeId, episodeId),
        eq(episodeSources.provider, parsed.provider),
        eq(episodeSources.externalId, parsed.externalId),
        sql`${episodeSources.status} not in ('removed', 'rejected')`,
      ),
    )
    .limit(1);

  if (duplicate !== undefined) {
    throw new ConflictError('To źródło zostało już dodane do tego odcinka.', {
      code: ErrorCode.ALREADY_EXISTS,
    });
  }

  const [created] = await database
    .insert(episodeSources)
    .values({
      episodeId,
      provider: parsed.provider,
      externalId: parsed.externalId,
      resourceKey: parsed.resourceKey ?? null,
      canonicalUrl: parsed.canonicalUrl,
      originalUrl: input.url,
      kind: input.kind,
      audioLanguage: input.audioLanguage ?? null,
      subtitleLanguage: input.subtitleLanguage ?? null,
      qualityHint: input.qualityHint ?? null,
      /*
       * A trusted submitter's source is live immediately; everyone else's
       * waits for a moderator. The attestation and the audit trail are
       * identical either way — the difference is visibility, not record
       * keeping, so a later complaint is answerable regardless.
       */
      status: submitter.publishImmediately === true ? SourceStatus.ACTIVE : SourceStatus.PENDING,
      submittedByUserId: submitter.userId,
      submittedByGroupId: submitter.groupId ?? null,
      // Stored verbatim with the timestamp, so the record shows what was
      // actually agreed to even after the UI copy changes.
      rightsAttestedAt: now(),
      rightsAttestationText: RIGHTS_ATTESTATION_TEXT_PL,
      submitterIpAddress: submitter.ipAddress,
      submitterNote: input.note ?? null,
      ...(submitter.metadata === undefined ? {} : { metadata: submitter.metadata }),
    })
    .returning({ id: episodeSources.id, status: episodeSources.status });

  if (created === undefined) throw new Error('Source insert returned no row.');

  return {
    id: created.id,
    status: created.status,
    provider: parsed.provider,
    normalizedUrl: parsed.canonicalUrl,
    message:
      created.status === SourceStatus.ACTIVE
        ? 'Źródło zostało dodane i jest już widoczne.'
        : 'Źródło zostało zgłoszone i oczekuje na moderację.',
  };
}

/** Parses a URL without storing it, so the UI can confirm before submission. */
export async function previewSource(
  episodeId: string,
  rawUrl: string,
  database: Database = db(),
): Promise<{
  provider: string;
  normalizedUrl: string;
  displayHost: string;
  canEmbed: boolean;
  alreadySubmitted: boolean;
}> {
  const url = parseSubmittedUrl(rawUrl);
  const parsed = providerRegistry.parse(url);

  const [existing] = await database
    .select({ id: episodeSources.id })
    .from(episodeSources)
    .where(
      and(
        eq(episodeSources.episodeId, episodeId),
        eq(episodeSources.provider, parsed.provider),
        eq(episodeSources.externalId, parsed.externalId),
        sql`${episodeSources.status} not in ('removed', 'rejected')`,
      ),
    )
    .limit(1);

  return {
    provider: parsed.provider,
    normalizedUrl: parsed.canonicalUrl,
    displayHost: parsed.displayHost,
    canEmbed: providerRegistry.canEmbed(parsed.provider),
    alreadySubmitted: existing !== undefined,
  };
}
