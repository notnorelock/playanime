import { Elysia } from 'elysia';
import { CalendarQuery } from '@playanime/contracts';
import { sessionContext } from '../../plugins/session.js';
import { getCalendar, listGenres } from './discovery.service.js';

export const discoveryController = new Elysia()
  .use(sessionContext)
  .get('/genres', ({ session }) => listGenres(session?.preferences.showMatureContent ?? false), {
    detail: { summary: 'List genres', tags: ['discovery'] },
  })
  .get(
    '/calendar',
    ({ query, session }) => getCalendar(query, session?.preferences.showMatureContent ?? false),
    {
      query: CalendarQuery,
      detail: { summary: 'Get release calendar', tags: ['discovery'] },
    },
  );
