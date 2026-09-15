import { Elysia, t } from 'elysia';
import { serializeError } from '@playanime/shared';
import {
  createPlaybackServices,
  listEpisodeSources,
  resolveEpisodePlayback,
  resolveSourcePlayback,
} from '../services/playback.js';

const services = createPlaybackServices();

function playbackContext(request: Request) {
  const origin = request.headers.get('origin') ?? 'https://playani.me';
  return {
    embedOrigin: origin,
    locale: request.headers.get('accept-language')?.split(',')[0] ?? 'pl',
    autoplay: false,
  };
}

/**
 * Episode source and playback routes.
 *
 * Handlers only validate and delegate. Provider resolution lives in
 * `@playanime/external-media` via the registry.
 */
export const mediaRoutes = new Elysia({ prefix: '/api/v1' })
  .get(
    '/episodes/:episodeId/sources',
    async ({ params, set }) => {
      try {
        return await listEpisodeSources(params.episodeId, services);
      } catch (error) {
        const serialized = serializeError(error);
        set.status = serialized.status;
        return serialized.body;
      }
    },
    {
      params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
    },
  )
  .get(
    '/episodes/:episodeId/playback',
    async ({ params, query, request, set }) => {
      try {
        return await resolveEpisodePlayback(
          params.episodeId,
          playbackContext(request),
          services,
          query.sourceId,
        );
      } catch (error) {
        const serialized = serializeError(error);
        set.status = serialized.status;
        return serialized.body;
      }
    },
    {
      params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
      query: t.Object({
        sourceId: t.Optional(t.String({ format: 'uuid' })),
      }),
    },
  )
  .get(
    '/sources/:sourceId/playback',
    async ({ params, query, request, set }) => {
      try {
        return await resolveSourcePlayback(params.sourceId, playbackContext(request), services, {
          refresh: query.refresh === '1' || query.refresh === 'true',
        });
      } catch (error) {
        const serialized = serializeError(error);
        set.status = serialized.status;
        return serialized.body;
      }
    },
    {
      params: t.Object({ sourceId: t.String({ format: 'uuid' }) }),
      query: t.Object({
        refresh: t.Optional(t.String()),
      }),
    },
  );
