import { and, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import type { LibraryQuery, LibraryUpsertBody, ProgressUpsertBody } from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { anime, episodes, mediaAssets } from '../schema/anime.js';
import { episodeProgress, libraryEntries } from '../schema/lists.js';

const animeSelection = {
  animeId: anime.id,
  slug: anime.slug,
  titleRomaji: anime.titleRomaji,
  titleEnglish: anime.titleEnglish,
  titleNative: anime.titleNative,
  titlePolish: anime.titlePolish,
  format: anime.format,
  releaseStatus: anime.status,
  season: anime.season,
  seasonYear: anime.seasonYear,
  episodeCount: anime.episodeCount,
  averageRating: anime.averageRating,
  posterUrl: mediaAssets.url,
  posterBlurhash: mediaAssets.blurhash,
  posterWidth: mediaAssets.width,
  posterHeight: mediaAssets.height,
};

export class LibraryRepository {
  constructor(private readonly db: Database) {}

  list(userId: string, status: LibraryQuery['status'], limit: number, before: Date | null) {
    const statusCondition: SQL | undefined =
      status === undefined ? undefined : eq(libraryEntries.status, status);
    return this.db
      .select({
        id: libraryEntries.id,
        status: libraryEntries.status,
        progressEpisodes: libraryEntries.progressEpisodes,
        rewatchCount: libraryEntries.rewatchCount,
        startedAt: libraryEntries.startedAt,
        finishedAt: libraryEntries.finishedAt,
        notes: libraryEntries.notes,
        isPrivate: libraryEntries.isPrivate,
        updatedAt: libraryEntries.updatedAt,
        ...animeSelection,
      })
      .from(libraryEntries)
      .innerJoin(anime, eq(anime.id, libraryEntries.animeId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.animeId, anime.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(
        and(
          eq(libraryEntries.userId, userId),
          statusCondition,
          before === null ? undefined : lt(libraryEntries.updatedAt, before),
          isNull(anime.deletedAt),
        ),
      )
      .orderBy(desc(libraryEntries.updatedAt))
      .limit(limit + 1);
  }

  async animeExists(animeId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: anime.id })
      .from(anime)
      .where(and(eq(anime.id, animeId), isNull(anime.deletedAt)))
      .limit(1);
    return row !== undefined;
  }

  async findEntry(userId: string, animeId: string) {
    const [row] = await this.db
      .select()
      .from(libraryEntries)
      .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.animeId, animeId)))
      .limit(1);
    return row ?? null;
  }

  async saveEntry(
    userId: string,
    animeId: string,
    existingId: string | null,
    values: Omit<LibraryUpsertBody, 'notes' | 'isPrivate'> & {
      notes: string | null;
      isPrivate: boolean;
      startedAt: Date | null | undefined;
      finishedAt: Date | null;
    },
  ) {
    const [row] =
      existingId === null
        ? await this.db
            .insert(libraryEntries)
            .values({ userId, animeId, ...values })
            .returning()
        : await this.db
            .update(libraryEntries)
            .set(values)
            .where(eq(libraryEntries.id, existingId))
            .returning();
    return row ?? null;
  }

  removeEntry(userId: string, animeId: string) {
    return this.db
      .delete(libraryEntries)
      .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.animeId, animeId)));
  }

  async findEpisode(episodeId: string) {
    const [row] = await this.db
      .select({ id: episodes.id, animeId: episodes.animeId })
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), isNull(episodes.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async upsertProgress(
    userId: string,
    episode: { id: string; animeId: string },
    input: ProgressUpsertBody,
    completed: boolean,
    timestamp: Date,
  ) {
    const values = {
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds ?? null,
      isCompleted: completed,
      completedAt: completed ? timestamp : null,
      lastWatchedAt: timestamp,
    };
    const [row] = await this.db
      .insert(episodeProgress)
      .values({ userId, episodeId: episode.id, animeId: episode.animeId, ...values })
      .onConflictDoUpdate({
        target: [episodeProgress.userId, episodeProgress.episodeId],
        set: values,
      })
      .returning();
    return row ?? null;
  }

  async findProgress(userId: string, episodeId: string) {
    const [row] = await this.db
      .select()
      .from(episodeProgress)
      .where(and(eq(episodeProgress.userId, userId), eq(episodeProgress.episodeId, episodeId)))
      .limit(1);
    return row ?? null;
  }

  listContinueWatching(userId: string, limit: number) {
    return this.db
      .select({
        positionSeconds: episodeProgress.positionSeconds,
        progressDuration: episodeProgress.durationSeconds,
        lastWatchedAt: episodeProgress.lastWatchedAt,
        episodeId: episodes.id,
        episodeNumber: episodes.number,
        absoluteNumber: episodes.absoluteNumber,
        episodeTitle: episodes.title,
        episodeTitlePolish: episodes.titlePolish,
        episodeSynopsis: episodes.synopsis,
        airedAt: episodes.airedAt,
        episodeDuration: episodes.durationSeconds,
        isFiller: episodes.isFiller,
        isRecap: episodes.isRecap,
        introStartSeconds: episodes.introStartSeconds,
        introEndSeconds: episodes.introEndSeconds,
        outroStartSeconds: episodes.outroStartSeconds,
        ...animeSelection,
      })
      .from(episodeProgress)
      .innerJoin(episodes, eq(episodes.id, episodeProgress.episodeId))
      .innerJoin(anime, eq(anime.id, episodeProgress.animeId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.animeId, anime.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(and(eq(episodeProgress.userId, userId), eq(episodeProgress.isCompleted, false)))
      .orderBy(desc(episodeProgress.lastWatchedAt))
      .limit(limit);
  }
}
