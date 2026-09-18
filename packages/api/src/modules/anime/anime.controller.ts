import { Elysia, t } from 'elysia';
import { AnimeListQuery, AnimeSlugParams } from '@playanime/contracts';
import { getAnimeBySlug, getEntryDetail, listAnime } from './anime.service.js';
import { sessionContext } from '../../plugins/session.js';

/**
 * Catalogue routes.
 *
 * Validation is declared with the schemas from `@playanime/contracts`: Elysia
 * compiles them into runtime validators, so a malformed query is rejected
 * before a handler runs and the handler's parameter types are inferred from the
 * same declaration. One definition, enforced at runtime and checked statically.
 */
export const animeController = new Elysia({ prefix: '/anime' })
  .use(sessionContext)
  .get(
    '/',
    async ({ query, session }) => {
      // Mature titles require both an authenticated user and an explicit
      // preference. Anonymous callers never receive them.
      const includeAdult = session?.preferences.showMatureContent ?? false;
      return listAnime(query, includeAdult);
    },
    {
      query: AnimeListQuery,
      detail: {
        summary: 'List anime',
        description:
          'Cursor-paginated catalogue with filtering and sorting. Mature titles are included only for authenticated users who have opted in.',
        tags: ['anime'],
      },
    },
  )
  .get(
    '/:slug',
    async ({ params, session }) => {
      const includeAdult = session?.preferences.showMatureContent ?? false;
      return getAnimeBySlug(params.slug, includeAdult);
    },
    {
      params: AnimeSlugParams,
      detail: {
        summary: 'Get anime by slug',
        description: 'Returns 404 for an unknown slug, and for a gated mature title.',
        tags: ['anime'],
      },
    },
  )
  .get(
    '/:slug/entries/:entryId',
    ({ params }) => getEntryDetail(params.slug, params.entryId),
    {
      params: t.Object({ slug: t.String(), entryId: t.String({ format: 'uuid' }) }),
      detail: {
        summary: 'Get full detail for one entry (a season/movie/OVA) of a series',
        description:
          'Fetched by the season selector once a non-default entry is picked — the series read already returns a compact summary of every entry, this returns the full one (synopsis, dates, studios, genres, tags) for just the one being viewed.',
        tags: ['anime'],
      },
    },
  );
