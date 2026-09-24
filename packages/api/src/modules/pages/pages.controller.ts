import { Elysia, t } from 'elysia';
import { literalUnion, SITE_PAGE_SLUGS, SitePageUpdateBody } from '@playanime/contracts';
import { requireAdmin } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import { getSitePage, updateSitePage } from './pages.service.js';

/**
 * Admin-editable static content pages (VIP today, extensible later). Public
 * read, admin-only write. See `packages/contracts/src/pages/index.ts` for
 * why the slug is a fixed enum rather than an open string.
 */

const SlugParams = t.Object({ slug: literalUnion(SITE_PAGE_SLUGS) });

export const pagesController = new Elysia({ prefix: '/pages' })
  .use(sessionContext)
  .get(
    '/:slug',
    ({ params }) => getSitePage(params.slug),
    {
      params: SlugParams,
      detail: {
        summary: 'One static content page, by slug',
        description: 'Null when this page has never been written yet. No auth required.',
        tags: ['pages'],
      },
    },
  )
  .patch(
    '/:slug',
    ({ params, body, session }) => {
      const auth = requireAdmin(session);
      return updateSitePage(auth.user.id, params.slug, body);
    },
    {
      params: SlugParams,
      body: SitePageUpdateBody,
      detail: {
        summary: 'Create or overwrite a static content page',
        description: 'Upserts on first write for this slug; overwrites in place afterward.',
        tags: ['pages'],
      },
    },
  );
