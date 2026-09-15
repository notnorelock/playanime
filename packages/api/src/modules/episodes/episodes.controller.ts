import { Elysia, t } from 'elysia';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NotFoundError, ErrorCode } from '@playanime/shared';
import { anime, db, episodes } from '@playanime/database';
import { sessionContext } from '../../plugins/session.js';

/**
 * Episode listing.
 *
 * Queries Drizzle directly: there is no filtering, pagination, or caching
 * complexity here that would justify a service and repository layer. Adding one
 * would be indirection for its own sake — the pattern is applied where it pays
 * (the catalogue), not uniformly.
 */

const EpisodeDto = t.Object({
  id: t.String({ format: 'uuid' }),
  number: t.Integer(),
  absoluteNumber: t.Union([t.Integer(), t.Null()]),
  title: t.Union([t.String(), t.Null()]),
  titlePolish: t.Union([t.String(), t.Null()]),
  synopsis: t.Union([t.String(), t.Null()]),
  airedAt: t.Union([t.String(), t.Null()]),
  durationSeconds: t.Union([t.Integer(), t.Null()]),
  isFiller: t.Boolean(),
  isRecap: t.Boolean(),
  /** Null when unknown; the player hides the skip control rather than guessing. */
  introStartSeconds: t.Union([t.Integer(), t.Null()]),
  introEndSeconds: t.Union([t.Integer(), t.Null()]),
  outroStartSeconds: t.Union([t.Integer(), t.Null()]),
});

export const episodesController = new Elysia({ prefix: '/anime/:slug/episodes' })
  .use(sessionContext)
  .get(
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
          number: episodes.number,
          absoluteNumber: episodes.absoluteNumber,
          title: episodes.title,
          titlePolish: episodes.titlePolish,
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
      response: t.Array(EpisodeDto),
      detail: {
        summary: 'List episodes for a title',
        description: 'Ordered by episode number. Soft-deleted episodes are excluded.',
        tags: ['episodes'],
      },
    },
  );
