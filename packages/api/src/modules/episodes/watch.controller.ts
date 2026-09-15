import { Elysia, t } from 'elysia';
import { sessionContext } from '../../plugins/session.js';
import { getWatchBootstrap } from './watch.service.js';

export const watchController = new Elysia({ prefix: '/episodes' })
  .use(sessionContext)
  .get('/:episodeId', ({ params, session }) => getWatchBootstrap(params.episodeId, session), {
    params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
    detail: { summary: 'Get episode watch bootstrap', tags: ['episodes'] },
  });
