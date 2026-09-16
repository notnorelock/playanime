import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../client/index.js';
import { anime, episodes, mediaAssets } from '../schema/anime.js';
import { episodeProgress } from '../schema/lists.js';

export class EpisodeRepository {
  constructor(private readonly db: Database) {}

  async findWatchEpisode(episodeId: string) {
    const [row] = await this.db
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
        animeSlug: anime.slug,
        animeTitle: anime.titleRomaji,
        animeFormat: anime.format,
        animeStatus: anime.status,
        isAdult: anime.isAdult,
        posterUrl: mediaAssets.url,
        posterBlurhash: mediaAssets.blurhash,
        posterWidth: mediaAssets.width,
        posterHeight: mediaAssets.height,
      })
      .from(episodes)
      .innerJoin(anime, eq(anime.id, episodes.animeId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.animeId, anime.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(and(eq(episodes.id, episodeId), isNull(episodes.deletedAt), isNull(anime.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async adjacent(animeId: string, number: number) {
    const [[previous], [next]] = await Promise.all([
      this.db
        .select({ id: episodes.id })
        .from(episodes)
        .where(and(eq(episodes.animeId, animeId), lt(episodes.number, number), isNull(episodes.deletedAt)))
        .orderBy(desc(episodes.number))
        .limit(1),
      this.db
        .select({ id: episodes.id })
        .from(episodes)
        .where(and(eq(episodes.animeId, animeId), gt(episodes.number, number), isNull(episodes.deletedAt)))
        .orderBy(asc(episodes.number))
        .limit(1),
    ]);
    return { previousId: previous?.id ?? null, nextId: next?.id ?? null };
  }

  async progress(userId: string, episodeId: string) {
    const [row] = await this.db
      .select({
        positionSeconds: episodeProgress.positionSeconds,
        durationSeconds: episodeProgress.durationSeconds,
        isCompleted: episodeProgress.isCompleted,
        lastWatchedAt: episodeProgress.lastWatchedAt,
      })
      .from(episodeProgress)
      .where(and(eq(episodeProgress.userId, userId), eq(episodeProgress.episodeId, episodeId)))
      .limit(1);
    return row ?? null;
  }
}
