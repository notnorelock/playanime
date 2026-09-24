import { Elysia, t } from 'elysia';
import {
  AnimeSyncRequest,
  CatalogueProposalDecisionBody,
  EntryCreateBody,
  EntryEditBody,
  EpisodeBulkCreateBody,
  EpisodeCreateBody,
  EpisodeCreditsSetBody,
  EpisodeEditBody,
  MediaAssetUpsertBody,
  SeriesCreateBody,
  SourceBatchSubmissionRequest,
  SourceUpdateBody,
  Slug,
} from '@playanime/contracts';
import { requireModerator } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { requireAuthoring, resolvePermissions } from './permissions.js';
import {
  addAsset,
  addEntry,
  animeAuditTrail,
  autofillFromAniList,
  checkDuplicates,
  createAnime,
  createEpisode,
  createEpisodeRange,
  decideCatalogueProposal,
  deleteEpisode,
  findAnimeByAnilistId,
  listEpisodeCredits,
  listEpisodesForEditing,
  listProposalQueue,
  listStaffForCredits,
  searchAniListTitles,
  setEpisodeCredits,
  syncAnimeFromAniList,
  updateAnime,
  updateEpisode,
} from './catalogue.service.js';
import {
  listOwnedSources,
  submitSourceBatch,
  updateOwnedSource,
  withdrawOwnedSource,
} from './sources.service.js';

/**
 * Catalogue authoring.
 *
 * Mounted under `/catalogue` to keep it apart from the public `/anime` read
 * routes: everything here writes, and the separation makes it obvious at a
 * glance which surface an endpoint belongs to.
 *
 * Authorization combines the platform role with translator-group membership,
 * resolved in `permissions.ts`. No route re-derives those rules.
 */

const SlugParams = t.Object({ slug: Slug });
const EpisodeParams = t.Object({ episodeId: t.String({ format: 'uuid' }) });
const SourceParams = t.Object({ sourceId: t.String({ format: 'uuid' }) });

export const catalogueController = new Elysia({ prefix: '/catalogue' })
  .use(sessionContext)

  /**
   * What the caller may author.
   *
   * A hint so the UI can render the right controls; every endpoint below still
   * decides for itself.
   */
  .get('/permissions', ({ session }) => resolvePermissions(session), {
    detail: {
      summary: 'Catalogue permissions for the current user',
      description:
        'Presentation hint only. Each endpoint enforces its own rules, so ignoring this yields a 403 rather than a broken write.',
      tags: ['catalogue'],
    },
  })

  /* ---------------------------------------------------------------- */
  /* Titles                                                            */
  /* ---------------------------------------------------------------- */

  .get('/duplicates', ({ query }) => checkDuplicates(query.title), {
    query: t.Object({ title: t.String({ minLength: 2, maxLength: 255 }) }),
    detail: {
      summary: 'Find titles similar to a proposed one',
      description:
        'Advisory. Distinct works legitimately share titles, so creation is never refused on a match — the author is shown it and decides.',
      tags: ['catalogue'],
    },
  })

  /* ---------------------------------------------------------------- */
  /* AniList search / autofill                                         */
  /* ---------------------------------------------------------------- */

  .group('', (app) =>
    app.use(rateLimit('anilistSearch')).get(
      '/anilist-search',
      async ({ query, session }) => {
        // Requires the same authoring rights as actually creating a
        // title — this proxies a real AniList request per call, and is
        // only ever meant to be reachable from inside the already-gated
        // "add anime" form, not a general-purpose public search.
        await requireAuthoring(session, null, { requireGroupForNonStaff: true });
        return searchAniListTitles(query.title);
      },
      {
        query: t.Object({ title: t.String({ minLength: 2, maxLength: 255 }) }),
        detail: {
          summary: 'Search AniList by title',
          description:
            'Live autocomplete for the "add anime" form. Each call proxies a real AniList request — rate limited more tightly than an ordinary read.',
          tags: ['catalogue'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('anilistSearch')).get(
      '/anilist-import/:anilistId',
      async ({ params, session }) => {
        await requireAuthoring(session, null, { requireGroupForNonStaff: true });
        return autofillFromAniList(params.anilistId);
      },
      {
        params: t.Object({ anilistId: t.Numeric() }),
        detail: {
          summary: 'Autofill the create-anime form from one AniList title',
          description:
            'Fetched once an author picks a search result. Genres are resolved to this catalogue\'s own slugs where a match exists; an AniList genre with no local match is omitted, never auto-created.',
          tags: ['catalogue'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.get(
      '/anime/by-anilist/:anilistId',
      async ({ params, session }) => {
        await requireAuthoring(session, null, { requireGroupForNonStaff: true });
        return findAnimeByAnilistId(params.anilistId);
      },
      {
        params: t.Object({ anilistId: t.Numeric() }),
        detail: {
          summary: 'Find an existing anime by AniList id',
          description:
            'A pure local lookup — no AniList request, so no rate limit beyond ordinary authoring access. Lets an AniList-first creation flow (including a bulk importer) check whether a title is already in the catalogue before creating it.',
          tags: ['catalogue'],
        },
      },
    ),
  )

  .group('', (app) =>
    app.use(rateLimit('createAnime')).post(
      '/anime',
      async ({ body, session, set }) => {
        // Non-staff author on behalf of a group, so every entry is attributable
        // to someone answerable for it. Attribution lives on the Entry, so the
        // group comes from `firstEntry`, not the series body itself.
        const context = await requireAuthoring(session, body.firstEntry?.groupId ?? null, {
          requireGroupForNonStaff: true,
        });

        const result = await createAnime(context, body);
        set.status = 201;
        return result;
      },
      {
        body: SeriesCreateBody,
        detail: {
          summary: 'Create an anime title',
          description:
            'The slug is derived server-side from the canonical title and is permanent. Staff, or an editor of a translator group.',
          tags: ['catalogue'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('createAnime')).post(
      '/anime/:slug/entries',
      async ({ params, body, session, set }) => {
        const context = await requireAuthoring(session, body.groupId, {
          requireGroupForNonStaff: true,
        });

        const result = await addEntry(context, params.slug, body);
        set.status = 201;
        return result;
      },
      {
        params: SlugParams,
        body: EntryCreateBody,
        detail: {
          summary: 'Add a new entry (a season, cour, movie, OVA...) to an existing series',
          description:
            'Additive: any authorized group may add a new release to an existing series, the same way source submission is open to any group. Does not go through the propose-for-review path.',
          tags: ['catalogue'],
        },
      },
    ),
  )
  .patch(
    '/anime/:slug',
    async ({ params, body, session }) => {
      const context = await requireAuthoring(session, body.groupId);
      return updateAnime(context, params.slug, body);
    },
    {
      params: SlugParams,
      body: EntryEditBody,
      detail: {
        summary: 'Edit a title',
        description:
          'Staff may edit any title; a group may edit only what it created. The slug is never changed.',
        tags: ['catalogue'],
      },
    },
  )
  .post(
    '/anime/:slug/assets',
    async ({ params, body, session, set }) => {
      const context = await requireAuthoring(session, null);
      const result = await addAsset(context, params.slug, body);
      set.status = 201;
      return result;
    },
    {
      params: SlugParams,
      body: MediaAssetUpsertBody,
      detail: { summary: 'Add artwork to a title', tags: ['catalogue'] },
    },
  )
  .group('', (app) =>
    app.use(rateLimit('anilistSearch')).post(
      '/anime/:slug/sync-anilist',
      async ({ params, body, session }) => {
        // Same ownership boundary an edit already has — this proxies a
        // real AniList request per call, same cost profile as the
        // search/autofill endpoints, hence reusing their rate limit.
        const context = await requireAuthoring(session, null);
        return syncAnimeFromAniList(context, params.slug, body.anilistId);
      },
      {
        params: SlugParams,
        body: AnimeSyncRequest,
        detail: {
          summary: 'Link an existing title to AniList and sync it',
          description:
            'Sets anilistId/malId, overwrites the poster and banner with AniList\'s current images, and adds (never removes) any matched genres and AniList tags.',
          tags: ['catalogue'],
        },
      },
    ),
  )

  /* ---------------------------------------------------------------- */
  /* Episodes                                                          */
  /* ---------------------------------------------------------------- */

  .get(
    '/anime/:slug/episodes',
    async ({ params, session }) => {
      const context = await requireAuthoring(session, null);
      return listEpisodesForEditing(context, params.slug);
    },
    {
      params: SlugParams,
      detail: {
        summary: 'List episodes for editing',
        description: 'Includes source counts, including sources still pending review.',
        tags: ['catalogue'],
      },
    },
  )
  .post(
    '/anime/:slug/episodes',
    async ({ params, body, session, set }) => {
      const context = await requireAuthoring(session, body.groupId);
      const result = await createEpisode(context, params.slug, body);
      set.status = 201;
      return result;
    },
    {
      params: SlugParams,
      body: EpisodeCreateBody,
      detail: { summary: 'Add an episode', tags: ['catalogue'] },
    },
  )
  .post(
    '/anime/:slug/episodes/bulk',
    async ({ params, body, session, set }) => {
      const context = await requireAuthoring(session, body.groupId);
      const result = await createEpisodeRange(context, params.slug, body);
      set.status = 201;
      return result;
    },
    {
      params: SlugParams,
      body: EpisodeBulkCreateBody,
      detail: {
        summary: 'Add a range of episodes',
        description:
          'Numbers that already exist are skipped and reported rather than failing the batch, so re-running a range is safe.',
        tags: ['catalogue'],
      },
    },
  )
  .patch(
    '/episodes/:episodeId',
    async ({ params, body, session }) => {
      const context = await requireAuthoring(session, body.groupId);
      return updateEpisode(context, params.episodeId, body);
    },
    {
      params: EpisodeParams,
      body: EpisodeEditBody,
      detail: { summary: 'Edit an episode', tags: ['catalogue'] },
    },
  )
  .delete(
    '/episodes/:episodeId',
    async ({ params, session }) => {
      const context = await requireAuthoring(session, null);
      return deleteEpisode(context, params.episodeId);
    },
    {
      params: EpisodeParams,
      detail: {
        summary: 'Remove an episode',
        description:
          'Soft delete. Watch progress, comments and sources point at the row, so it is hidden rather than destroyed.',
        tags: ['catalogue'],
      },
    },
  )
  .get(
    '/episodes/:episodeId/credits',
    ({ params }) => listEpisodeCredits(params.episodeId),
    {
      params: EpisodeParams,
      detail: { summary: 'Who is credited on this episode', tags: ['catalogue'] },
    },
  )
  .get(
    '/staff',
    ({ session }) => {
      requireModerator(session);
      return listStaffForCredits();
    },
    {
      detail: {
        summary: 'Current moderator/admin roster',
        description: 'Username-only, unlike the admin-only full user list — for crediting a staff member directly with no group.',
        tags: ['catalogue'],
      },
    },
  )
  .put(
    '/episodes/:episodeId/credits',
    async ({ params, body, session }) => {
      // Resolved without a groupId here on purpose: requireAuthoring's
      // groupId path always demands the caller's own editor-or-above
      // membership in that exact group, which is too strict for crediting
      // — staff moderate credits for groups they don't belong to (e.g. an
      // episode with no group attribution at all, or fixing another
      // group's credit list). setEpisodeCredits does its own resolution:
      // a non-staff caller may only credit as a group they belong to
      // (checked there against body.groupId), staff may credit as any
      // real group.
      const context = await requireAuthoring(session, null);
      return setEpisodeCredits(context, params.episodeId, body.groupId, body.credits);
    },
    {
      params: EpisodeParams,
      body: EpisodeCreditsSetBody,
      detail: {
        summary: 'Set who a group credits on an episode',
        description:
          'Replaces every credit previously set for the given group on this episode with exactly this list. Non-staff may only act as a group they belong to at editor rank or above; staff may credit as any group.',
        tags: ['catalogue'],
      },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Sources                                                           */
  /* ---------------------------------------------------------------- */

  .get(
    '/episodes/:episodeId/sources',
    async ({ params, session }) => {
      const context = await requireAuthoring(session, null);
      return listOwnedSources(params.episodeId, context);
    },
    {
      params: EpisodeParams,
      detail: {
        summary: 'List sources for editing',
        description:
          'Includes moderation status. Staff see every row; a submitter sees their own and their group\'s.',
        tags: ['catalogue'],
      },
    },
  )
  .group('', (app) =>
    app.use(rateLimit('submitSource')).post(
      '/episodes/:episodeId/sources',
      async ({ params, body, session, clientIp, set }) => {
        const context = await requireAuthoring(session, body.groupId);
        const result = await submitSourceBatch(params.episodeId, body, context, clientIp);
        set.status = 201;
        return result;
      },
      {
        params: EpisodeParams,
        body: SourceBatchSubmissionRequest,
        detail: {
          summary: 'Submit one or more sources for an episode',
          description:
            'Sources from staff and from verified groups publish immediately; everything else queues for moderation. The rights attestation is recorded verbatim either way.',
          tags: ['catalogue'],
        },
      },
    ),
  )
  .patch(
    '/sources/:sourceId',
    async ({ params, body, session }) => {
      const context = await requireAuthoring(session, null);
      return updateOwnedSource(params.sourceId, body, context);
    },
    {
      params: SourceParams,
      body: SourceUpdateBody,
      detail: {
        summary: 'Edit source metadata',
        description:
          'Language and quality hints only. Changing the URL would swap the target of an approved source, so that requires a new submission.',
        tags: ['catalogue'],
      },
    },
  )
  .delete(
    '/sources/:sourceId',
    async ({ params, session }) => {
      const context = await requireAuthoring(session, null);
      return withdrawOwnedSource(params.sourceId, context);
    },
    {
      params: SourceParams,
      detail: {
        summary: 'Withdraw a source',
        description: 'The row is retained so the moderation history survives.',
        tags: ['catalogue'],
      },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Cross-group edit proposals and audit trail                        */
  /* ---------------------------------------------------------------- */

  .get(
    '/anime/:slug/audit',
    async ({ params, session }) => {
      const context = await requireAuthoring(session, null);
      return animeAuditTrail(context, params.slug);
    },
    {
      params: SlugParams,
      detail: {
        summary: "A title's own audit trail",
        description:
          "Every recorded edit to the anime row and its episodes, with real before/after values. Readable by staff or the title's owning group — not just staff.",
        tags: ['catalogue'],
      },
    },
  )
  .get(
    '/proposals',
    ({ session }) => {
      requireModerator(session);
      return listProposalQueue();
    },
    {
      detail: {
        summary: 'Pending cross-group edit proposals',
        description: 'Every proposal awaiting a decision, newest first.',
        tags: ['catalogue'],
      },
    },
  )
  .post(
    '/proposals/:proposalId/decision',
    ({ params, body, session }) => {
      const moderator = requireModerator(session);
      return decideCatalogueProposal(moderator.user.id, params.proposalId, body);
    },
    {
      params: t.Object({ proposalId: t.String({ format: 'uuid' }) }),
      body: CatalogueProposalDecisionBody,
      detail: {
        summary: 'Approve or reject a pending proposal',
        description:
          'On approval, applies the proposed change through the same path a direct edit would take, then records a full before/after audit entry. On rejection, nothing in the catalogue changes.',
        tags: ['catalogue'],
      },
    },
  );
