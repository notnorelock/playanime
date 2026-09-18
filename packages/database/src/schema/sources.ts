import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  availabilityStatusEnum,
  fk,
  mediaProviderEnum,
  primaryId,
  qualityHintEnum,
  sourceKindEnum,
  sourceLanguageEnum,
  sourceStatusEnum,
  timestamps,
} from './_shared.js';
import { episodes } from './anime.js';
import { reports } from './moderation.js';
import { users } from './users.js';

/**
 * External episode sources.
 *
 * PlayAnime does not host video. A row here is a *link* to a third-party
 * provider, plus the moderation state governing whether viewers may see it.
 *
 * What is deliberately NOT stored: any resolved or signed playback URL. Those
 * are ephemeral and provider-issued; this table holds only the stable identity
 * of the resource (`provider` + `external_id`), from which a descriptor is
 * rebuilt per request.
 */
export const episodeSources = pgTable(
  'episode_sources',
  {
    id: primaryId(),
    episodeId: fk('episode_id')
      .references(() => episodes.id, { onDelete: 'cascade' })
      .notNull(),

    provider: mediaProviderEnum('provider').notNull(),

    /**
     * Provider-side identifier: a YouTube video id, a Drive file id. Stable
     * across the URL variations that point at the same resource, which is what
     * makes deduplication and blocking work.
     */
    externalId: varchar('external_id', { length: 512 }).notNull(),

    /** Secondary access parameter (e.g. a Drive resourceKey) from the shared link. */
    resourceKey: varchar('resource_key', { length: 128 }),

    /** Normalized URL. What the UI displays and what an off-site link opens. */
    canonicalUrl: text('canonical_url').notNull(),
    /** Exactly as submitted, for moderation review. */
    originalUrl: text('original_url').notNull(),

    kind: sourceKindEnum('kind').notNull().default('sub'),
    audioLanguage: sourceLanguageEnum('audio_language'),
    subtitleLanguage: sourceLanguageEnum('subtitle_language'),
    qualityHint: qualityHintEnum('quality_hint'),

    status: sourceStatusEnum('status').notNull().default('pending'),

    /** True only once a moderator confirms the metadata is accurate. */
    isVerified: boolean('is_verified').notNull().default(false),
    /** Manual ordering override. Higher sorts first. */
    priority: smallint('priority').notNull().default(0),

    /* ---------------------------------------------------------------------- */
    /* Rights attestation — a legal record, so it is explicit and immutable    */
    /* ---------------------------------------------------------------------- */

    submittedByUserId: fk('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * Translator group credited for this source.
     *
     * Also what decides whether the source publishes immediately: a member of a
     * platform-verified group is trusted to publish, while everyone else's
     * submission queues for moderation. The group is recorded rather than the
     * decision, so revoking a group's verification affects what it submits next
     * without rewriting history.
     *
     * Without a foreign key for the same reason as `anime.created_by_group_id`:
     * `translators.ts` imports this module. The constraint is in the migration.
     */
    submittedByGroupId: fk('submitted_by_group_id'),

    /** When the submitter affirmed they hold the rights. Null for imports. */
    rightsAttestedAt: timestamp('rights_attested_at', { withTimezone: true, mode: 'date' }),
    /**
     * The attestation wording, stored verbatim. Keeping the text means a later
     * enquiry shows what was actually agreed to, even after the UI copy changes.
     */
    rightsAttestationText: text('rights_attestation_text'),
    /** Submitter's IP at attestation time, as part of the record. */
    submitterIpAddress: varchar('submitter_ip_address', { length: 45 }),

    /** Free-text note from the submitter, e.g. "episode 12, PL subs". */
    submitterNote: varchar('submitter_note', { length: 500 }),

    /**
     * Why a moderator rejected or disabled this source.
     *
     * Shown to the submitter so a pending source that never appeared is
     * explicable, rather than silently vanishing.
     */
    moderationNote: varchar('moderation_note', { length: 500 }),

    /* ---------------------------------------------------------------------- */
    /* Availability, maintained by the health worker                          */
    /* ---------------------------------------------------------------------- */

    availability: availabilityStatusEnum('availability').notNull().default('unknown'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }),
    lastAvailableAt: timestamp('last_available_at', { withTimezone: true, mode: 'date' }),
    /** Drives exponential backoff; reset to 0 on a successful check. */
    failureCount: integer('failure_count').notNull().default(0),
    /** Earliest next probe. Respects provider rate limits. */
    nextCheckAt: timestamp('next_check_at', { withTimezone: true, mode: 'date' }),

    /**
     * Provider-specific metadata that does not deserve a column.
     *
     * Keeps the table from growing a nullable column per provider. Anything
     * filtered or sorted on gets a real column instead; this is for display
     * detail only, and never holds credentials or signed URLs.
     */
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),

    ...timestamps(),
    /** Soft removal. Moderation history is never destroyed. */
    disabledAt: timestamp('disabled_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    /**
     * One live row per resource per episode.
     *
     * Partial, so a removed source does not block a legitimate resubmission
     * after a takedown is resolved — while the bar below handles the cases
     * where resubmission must stay blocked.
     */
    uniqueIndex('episode_sources_resource_key')
      .on(table.episodeId, table.provider, table.externalId)
      .where(sql`${table.status} not in ('removed', 'rejected')`),

    /**
     * Blocks resubmission of a resource taken down for cause, anywhere in the
     * catalogue — not merely on the same episode. Re-uploading the same Drive
     * file against a different episode must not slip through.
     */
    uniqueIndex('episode_sources_barred_key')
      .on(table.provider, table.externalId)
      .where(sql`${table.status} in ('blocked', 'copyright_claim')`),

    // The viewer-facing query: active sources for an episode, best first.
    index('episode_sources_playable_idx')
      .on(table.episodeId, sql`${table.priority} desc`)
      .where(sql`${table.status} = 'active'`),

    // The moderation queue.
    index('episode_sources_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),

    // The health worker's claim query.
    index('episode_sources_next_check_idx')
      .on(table.nextCheckAt)
      .where(sql`${table.status} = 'active'`),

    index('episode_sources_submitter_idx').on(table.submittedByUserId),
    index('episode_sources_group_idx').on(table.submittedByGroupId),
    index('episode_sources_provider_idx').on(table.provider),
  ],
);

/**
 * Blocked provider resources.
 *
 * Separate from `episode_sources` so a takedown survives deletion of the source
 * row, and so a resource can be pre-emptively blocked before anyone submits it.
 */
export const blockedResources = pgTable(
  'blocked_resources',
  {
    id: primaryId(),
    provider: mediaProviderEnum('provider').notNull(),
    /** Null blocks the entire provider rather than one resource. */
    externalId: varchar('external_id', { length: 512 }),
    /** Blocks a whole domain, for the generic external-link provider. */
    domain: varchar('domain', { length: 253 }),

    reason: text('reason').notNull(),
    blockedByUserId: fk('blocked_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('blocked_resources_provider_external_key')
      .on(table.provider, table.externalId)
      .where(sql`${table.externalId} is not null`),
    uniqueIndex('blocked_resources_domain_key')
      .on(table.domain)
      .where(sql`${table.domain} is not null`),
  ],
);

export const episodeSourcesRelations = relations(episodeSources, ({ one }) => ({
  episode: one(episodes, { fields: [episodeSources.episodeId], references: [episodes.id] }),
  submitter: one(users, { fields: [episodeSources.submittedByUserId], references: [users.id] }),
}));

export const blockedResourcesRelations = relations(blockedResources, ({ one }) => ({
  blockedBy: one(users, { fields: [blockedResources.blockedByUserId], references: [users.id] }),
}));

/**
 * Blocked catalogue titles.
 *
 * A different axis from `blockedResources`: that table bars a *video
 * provider resource* (a YouTube id, a Drive file); this one bars a *catalogue
 * entry* by its AniList/MAL identity, so a title taken down for a rights
 * complaint cannot simply be re-imported by autofill or a sync. Separate from
 * `anime.deletedAt` so the block survives even if the row it originated from
 * is ever hard-deleted.
 */
export const blockedTitles = pgTable(
  'blocked_titles',
  {
    id: primaryId(),
    /** At least one of `anilistId`/`malId` is set; enforced at the application layer. */
    anilistId: integer('anilist_id'),
    malId: integer('mal_id'),

    reason: text('reason').notNull(),
    /** The report that caused this block, when there was one. */
    reportId: fk('report_id').references(() => reports.id, { onDelete: 'set null' }),
    blockedByUserId: fk('blocked_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('blocked_titles_anilist_key')
      .on(table.anilistId)
      .where(sql`${table.anilistId} is not null`),
    uniqueIndex('blocked_titles_mal_key').on(table.malId).where(sql`${table.malId} is not null`),
  ],
);

export const blockedTitlesRelations = relations(blockedTitles, ({ one }) => ({
  blockedBy: one(users, { fields: [blockedTitles.blockedByUserId], references: [users.id] }),
  report: one(reports, { fields: [blockedTitles.reportId], references: [reports.id] }),
}));

export type EpisodeSourceRow = typeof episodeSources.$inferSelect;
export type NewEpisodeSourceRow = typeof episodeSources.$inferInsert;
export type BlockedResourceRow = typeof blockedResources.$inferSelect;
export type BlockedTitleRow = typeof blockedTitles.$inferSelect;
export type NewBlockedTitleRow = typeof blockedTitles.$inferInsert;
