import { Elysia } from 'elysia';
import { CalendarQuery, RankingQuery } from '@playanime/contracts';
import { sessionContext } from '../../plugins/session.js';
import { getCalendar, listGenres, listTags } from './discovery.service.js';
import { getRanking } from './ranking.service.js';

export const discoveryController = new Elysia()
  .use(sessionContext)
  .get(
    '/ranking',
    ({ query, session }) => getRanking(query.period, query.limit, session?.preferences.showMatureContent ?? false),
    {
      query: RankingQuery,
      detail: {
        summary: 'Time-windowed popularity ranking',
        description:
          'Ranked by distinct viewers within the period — week/month/year/all-time. Cached briefly server-side.',
        tags: ['discovery'],
      },
    },
  )
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
