import { Elysia, t } from 'elysia';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NotFoundError, ErrorCode } from '@playanime/shared';
import {
  AnimeRepository,
  db,
  entries,
  episodes,
  LibraryRepository,
  series,
  type EpisodeProgressRow,
} from '@playanime/database';
import { EpisodeSummary } from '@playanime/contracts';
import { sessionContext } from '../../plugins/session.js';

/**
 * Episode listing.
 *
 * Queries Drizzle directly for the main-entry route: there is no filtering,
 * pagination, or caching complexity here that would justify a service and
 * repository layer. Adding one would be indirection for its own sake — the
 * pattern is applied where it pays (the catalogue), not uniformly.
 * `LibraryRepository.progressForSeries` is reused rather than
 * reimplemented, since it already exists for the single-episode watch
 * bootstrap's own progress read.
 *
 * `:slug` resolves to a Series. `/anime/:slug/episodes` lists episodes for
 * its main entry — the common single-release case, kept for URL
 * compatibility. `/anime/:slug/entries/:entryId/episodes` is the
 * entry-scoped route the season selector uses once a non-default entry
 * (an OVA, a later season, ...) is picked.
 */

const libraryRepository = new LibraryRepository(db());
const animeRepository = new AnimeRepository(db());

async function hydrateProgress(
  rows: readonly Omit<EpisodeSummary, 'progress'>[],
  seriesId: string,
  userId: string | undefined,
): Promise<EpisodeSummary[]> {
  const progressByEpisodeId: Map<string, EpisodeProgressRow> =
    userId === undefined
      ? new Map<string, EpisodeProgressRow>()
      : await libraryRepository.progressForSeries(userId, seriesId);

  return rows.map((row) => {
    const progress = progressByEpisodeId.get(row.id);
    return {
      ...row,
      progress:
        progress === undefined
          ? null
          : {
              positionSeconds: progress.positionSeconds,
              durationSeconds: progress.durationSeconds,
              isCompleted: progress.isCompleted,
              lastWatchedAt: progress.lastWatchedAt.toISOString(),
            },
    };
  });
}

export const episodesController = new Elysia({ prefix: '/anime/:slug' })
  .use(sessionContext)
  .get(
    '/episodes',
    async ({ params, session }) => {
      const [mainEntry] = await db()
        .select({ id: entries.id, seriesId: entries.seriesId })
        .from(entries)
        .innerJoin(series, eq(series.id, entries.seriesId))
        .where(
          and(
            eq(series.slug, params.slug),
            eq(entries.isMainEntry, true),
            isNull(series.deletedAt),
            isNull(entries.deletedAt),
          ),
        )
        .limit(1);

      if (mainEntry === undefined) {
        throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
      }

      const rows = await db()
        .select({
          id: episodes.id,
          entryId: episodes.entryId,
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
        .where(and(eq(episodes.entryId, mainEntry.id), isNull(episodes.deletedAt)))
        .orderBy(asc(episodes.number));

      return hydrateProgress(rows, mainEntry.seriesId, session?.user.id);
    },
    {
      params: t.Object({ slug: t.String() }),
      response: t.Array(EpisodeSummary),
      detail: {
        summary: 'List episodes for a title',
        description:
          'Episodes of the series\' main entry, ordered by episode number. Soft-deleted episodes are excluded. Each episode carries the signed-in viewer\'s own progress, if any.',
        tags: ['episodes'],
      },
    },
  )
  .get(
    '/entries/:entryId/episodes',
    async ({ params, session }) => {
      const rows = await animeRepository.episodesForEntry(params.slug, params.entryId);

      // An entry id that doesn't belong to this series (or doesn't exist)
      // returns an empty list rather than a distinct row to key a seriesId
      // off — resolve the series id through the entry rows found, or fall
      // back to an empty page rather than 404ing a season with no
      // episodes yet, which is a real, valid state.
      if (rows.length === 0) return [];

      const [entryRow] = await db()
        .select({ seriesId: entries.seriesId })
        .from(entries)
        .where(eq(entries.id, params.entryId))
        .limit(1);

      if (entryRow === undefined) return [];

      return hydrateProgress(rows, entryRow.seriesId, session?.user.id);
    },
    {
      params: t.Object({ slug: t.String(), entryId: t.String({ format: 'uuid' }) }),
      response: t.Array(EpisodeSummary),
      detail: {
        summary: 'List episodes for one entry (season/movie/OVA) of a title',
        description:
          'Ordered by episode number. Returns an empty list for an entry that does not belong to this series or has no episodes yet.',
        tags: ['episodes'],
      },
    },
  );
