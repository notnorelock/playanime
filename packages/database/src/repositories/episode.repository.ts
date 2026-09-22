import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Database } from '../client/index.js';
import { entries, episodes, mediaAssets, series } from '../schema/anime.js';
import { episodeProgress } from '../schema/lists.js';

export class EpisodeRepository {
  constructor(private readonly db: Database) {}

  async findWatchEpisode(episodeId: string) {
    const [row] = await this.db
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
        earlyAccessUntil: episodes.earlyAccessUntil,
        entrySlug: entries.slug,
        entryTitle: entries.titleRomaji,
        entryType: entries.entryType,
        entryStatus: entries.status,
        seasonNumber: entries.seasonNumber,
        courNumber: entries.courNumber,
        seriesId: entries.seriesId,
        seriesSlug: series.slug,
        seriesTitle: series.title,
        isAdult: entries.isAdult,
        vipOnly: entries.vipOnly,
        posterUrl: mediaAssets.url,
        posterBlurhash: mediaAssets.blurhash,
        posterWidth: mediaAssets.width,
        posterHeight: mediaAssets.height,
      })
      .from(episodes)
      .innerJoin(entries, eq(entries.id, episodes.entryId))
      .innerJoin(series, eq(series.id, entries.seriesId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.entryId, entries.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(and(eq(episodes.id, episodeId), isNull(episodes.deletedAt), isNull(entries.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async adjacent(entryId: string, number: number) {
    const [[previous], [next]] = await Promise.all([
      this.db
        .select({ id: episodes.id })
        .from(episodes)
        .where(and(eq(episodes.entryId, entryId), lt(episodes.number, number), isNull(episodes.deletedAt)))
        .orderBy(desc(episodes.number))
        .limit(1),
      this.db
        .select({ id: episodes.id })
        .from(episodes)
        .where(and(eq(episodes.entryId, entryId), gt(episodes.number, number), isNull(episodes.deletedAt)))
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
