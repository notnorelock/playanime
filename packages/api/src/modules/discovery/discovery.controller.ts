import { Elysia } from 'elysia';
import { CalendarQuery } from '@playanime/contracts';
import { sessionContext } from '../../plugins/session.js';
import { getCalendar, listGenres, listTags } from './discovery.service.js';

export const discoveryController = new Elysia()
  .use(sessionContext)
  .get('/genres', ({ session }) => listGenres(session?.preferences.showMatureContent ?? false), {
    detail: { summary: 'List genres', tags: ['discovery'] },
  })
  .get('/tags', ({ session }) => listTags(session?.preferences.showMatureContent ?? false), {
    detail: {
      summary: 'List tags',
      description: "AniList's much larger free-form set, created on demand from every sync.",
      tags: ['discovery'],
    },
  })
  .get(
    '/calendar',
    ({ query, session }) => getCalendar(query, session?.preferences.showMatureContent ?? false),
    {
      query: CalendarQuery,
      detail: { summary: 'Get release calendar', tags: ['discovery'] },
    },
  );
