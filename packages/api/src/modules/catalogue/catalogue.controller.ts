import { Elysia, t } from 'elysia';
import {
  AnimeCreateBody,
  AnimeEditBody,
  EpisodeBulkCreateBody,
  EpisodeCreateBody,
  EpisodeEditBody,
  MediaAssetUpsertBody,
  SourceBatchSubmissionRequest,
  SourceUpdateBody,
  Slug,
} from '@playanime/contracts';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { requireAuthoring, resolvePermissions } from './permissions.js';
import {
  addAsset,
  autofillFromAniList,
  checkDuplicates,
  createAnime,
  createEpisode,
  createEpisodeRange,
  deleteEpisode,
  listEpisodesForEditing,
  searchAniListTitles,
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
    app.use(rateLimit('createAnime')).post(
      '/anime',
      async ({ body, session, set }) => {
        // Non-staff author on behalf of a group, so every entry is attributable
        // to someone answerable for it.
        const context = await requireAuthoring(session, body.groupId, {
          requireGroupForNonStaff: true,
        });

        const result = await createAnime(context, body);
        set.status = 201;
        return result;
      },
      {
        body: AnimeCreateBody,
        detail: {
          summary: 'Create an anime title',
          description:
            'The slug is derived server-side from the canonical title and is permanent. Staff, or an editor of a translator group.',
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
      body: AnimeEditBody,
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
  );
