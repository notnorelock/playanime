import { Elysia } from 'elysia';
import { AnimeListQuery, AnimeSlugParams } from '@playanime/contracts';
import { getAnimeBySlug, listAnime } from './anime.service.js';
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
  );
