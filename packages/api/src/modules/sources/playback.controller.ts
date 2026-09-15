import { Elysia, t } from 'elysia';
import {
  createPlaybackServices,
  resolveEpisodePlayback,
  resolveSourcePlayback,
} from '../../services/playback.js';
import { sessionContext } from '../../plugins/session.js';

const services = createPlaybackServices();

function context(request: Request, locale: string) {
  return {
    embedOrigin: request.headers.get('origin') ?? 'https://playani.me',
    locale,
    autoplay: false,
  };
}

export const playbackController = new Elysia()
  .use(sessionContext)
  .get(
    '/episodes/:episodeId/playback',
    ({ params, query, request, session }) =>
      resolveEpisodePlayback(
        params.episodeId,
        context(request, session?.preferences.locale ?? 'pl'),
        services,
        query.sourceId,
      ),
    {
      params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
      query: t.Object({ sourceId: t.Optional(t.String({ format: 'uuid' })) }),
      detail: { summary: 'Resolve episode playback', tags: ['playback'] },
    },
  )
  .get(
    '/sources/:sourceId/playback',
    ({ params, query, request, session }) =>
      resolveSourcePlayback(
        params.sourceId,
        context(request, session?.preferences.locale ?? 'pl'),
        services,
        { refresh: query.refresh === '1' || query.refresh === 'true' },
      ),
    {
      params: t.Object({ sourceId: t.String({ format: 'uuid' }) }),
      query: t.Object({ refresh: t.Optional(t.String()) }),
      detail: { summary: 'Resolve source playback', tags: ['playback'] },
    },
  );
