import { Elysia, t } from 'elysia';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NotFoundError, ErrorCode } from '@playanime/shared';
import { anime, db, episodes } from '@playanime/database';
import { EpisodeSummary } from '@playanime/contracts';
import { sessionContext } from '../../plugins/session.js';

/**
 * Episode listing.
 *
 * Queries Drizzle directly: there is no filtering, pagination, or caching
 * complexity here that would justify a service and repository layer. Adding one
 * would be indirection for its own sake — the pattern is applied where it pays
 * (the catalogue), not uniformly.
 */

export const episodesController = new Elysia({ prefix: '/anime/:slug/episodes' }).use(sessionContext).get(
  '/',
  async ({ params }) => {
    const [title] = await db()
      .select({ id: anime.id })
      .from(anime)
      .where(and(eq(anime.slug, params.slug), isNull(anime.deletedAt)))
      .limit(1);

    if (title === undefined) {
      throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
    }

    const rows = await db()
      .select({
        id: episodes.id,
        animeId: episodes.animeId,
        number: episodes.number,
        absoluteNumber: episodes.absoluteNumber,
        title: episodes.title,
        synopsis: episodes.synopsis,
        airedAt: episodes.airedAt,
        durationSeconds: episodes.durationSeconds,
        isFiller: episodes.isFiller,
        isRecap: episodes.isRecap,
        introStartSeconds: episodes.introStartSeconds,
        introEndSeconds: episodes.introEndSeconds,
        outroStartSeconds: episodes.outroStartSeconds,
      })
      .from(episodes)
      .where(and(eq(episodes.animeId, title.id), isNull(episodes.deletedAt)))
      .orderBy(asc(episodes.number));

    return rows;
  },
  {
    params: t.Object({ slug: t.String() }),
    response: t.Array(EpisodeSummary),
    detail: {
      summary: 'List episodes for a title',
      description: 'Ordered by episode number. Soft-deleted episodes are excluded.',
      tags: ['episodes'],
    },
  },
);
