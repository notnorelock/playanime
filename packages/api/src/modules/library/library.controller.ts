import { Elysia, t } from 'elysia';
import { LibraryQuery, LibraryUpsertBody, ProgressUpsertBody } from '@playanime/contracts';
import { requireAuth } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import {
  getLibraryStatus,
  getProgress,
  listContinueWatching,
  listLibrary,
  removeLibraryEntry,
  saveLibraryEntry,
  saveProgress,
} from './library.service.js';

export const libraryController = new Elysia()
  .use(sessionContext)
  .get('/library', ({ query, session }) => listLibrary(requireAuth(session).user.id, query), {
    query: LibraryQuery,
    detail: { summary: 'List current user library', tags: ['library'] },
  })
  .get(
    '/library/:animeId',
    ({ params, session }) => getLibraryStatus(requireAuth(session).user.id, params.animeId),
    {
      params: t.Object({ animeId: t.String({ format: 'uuid' }) }),
      detail: {
        summary: 'This title\'s status in the current user\'s library',
        description: 'Null when the title has never been added.',
        tags: ['library'],
      },
    },
  )
  .put(
    '/library/:animeId',
    async ({ params, body, session, set }) => {
      const result = await saveLibraryEntry(requireAuth(session).user.id, params.animeId, body);
      set.status = result.created ? 201 : 200;
      return result.row;
    },
    {
      params: t.Object({ animeId: t.String({ format: 'uuid' }) }),
      body: LibraryUpsertBody,
      detail: { summary: 'Create or update library entry', tags: ['library'] },
    },
  )
  .delete(
    '/library/:animeId',
    ({ params, session }) => removeLibraryEntry(requireAuth(session).user.id, params.animeId),
    {
      params: t.Object({ animeId: t.String({ format: 'uuid' }) }),
      detail: { summary: 'Remove library entry', tags: ['library'] },
    },
  )
  .put(
    '/progress/:episodeId',
    ({ params, body, session }) => saveProgress(requireAuth(session).user.id, params.episodeId, body),
    {
      params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
      body: ProgressUpsertBody,
      detail: { summary: 'Upsert episode progress', tags: ['progress'] },
    },
  )
  .get(
    '/progress/:episodeId',
    ({ params, session }) => getProgress(requireAuth(session).user.id, params.episodeId),
    {
      params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
      detail: { summary: 'Get episode progress', tags: ['progress'] },
    },
  )
  .get('/continue-watching', ({ session }) => listContinueWatching(requireAuth(session).user.id), {
    detail: { summary: 'Continue watching rail', tags: ['progress'] },
  });
