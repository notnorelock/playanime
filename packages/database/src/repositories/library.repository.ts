import { and, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import type { LibraryQuery, LibraryUpsertBody, ProgressUpsertBody } from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { entries, episodes, mediaAssets, series } from '../schema/anime.js';
import { episodeProgress, libraryEntries } from '../schema/lists.js';

export type EpisodeProgressRow = typeof episodeProgress.$inferSelect;

const seriesSelection = {
  seriesId: series.id,
  slug: series.slug,
  title: series.title,
  averageRating: series.averageRating,
  posterUrl: mediaAssets.url,
  posterBlurhash: mediaAssets.blurhash,
  posterWidth: mediaAssets.width,
  posterHeight: mediaAssets.height,
};

export class LibraryRepository {
  constructor(private readonly db: Database) {}

  /**
   * `onlyPublic` scopes this to entries the owner has not marked private — the
   * one flag that differs between a viewer reading their own list and a
   * visitor reading someone else's.
   */
  list(
    userId: string,
    status: LibraryQuery['status'],
    limit: number,
    before: Date | null,
    onlyPublic = false,
  ) {
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
        ...seriesSelection,
      })
      .from(libraryEntries)
      .innerJoin(series, eq(series.id, libraryEntries.seriesId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.seriesId, series.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(
        and(
          eq(libraryEntries.userId, userId),
          statusCondition,
          onlyPublic ? eq(libraryEntries.isPrivate, false) : undefined,
          before === null ? undefined : lt(libraryEntries.updatedAt, before),
          isNull(series.deletedAt),
        ),
      )
      .orderBy(desc(libraryEntries.updatedAt))
      .limit(limit + 1);
  }

  async seriesExists(seriesId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
      .limit(1);
    return row !== undefined;
  }

  async findEntry(userId: string, seriesId: string) {
    const [row] = await this.db
      .select()
      .from(libraryEntries)
      .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.seriesId, seriesId)))
      .limit(1);
    return row ?? null;
  }

  async saveEntry(
    userId: string,
    seriesId: string,
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
            .values({ userId, seriesId, ...values })
            .returning()
        : await this.db
            .update(libraryEntries)
            .set(values)
            .where(eq(libraryEntries.id, existingId))
            .returning();
    return row ?? null;
  }

  removeEntry(userId: string, seriesId: string) {
    return this.db
      .delete(libraryEntries)
      .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.seriesId, seriesId)));
  }

  /** An episode's entry and, through it, its series — for progress writes that need the denormalized `seriesId`. */
  async findEpisode(episodeId: string) {
    const [row] = await this.db
      .select({ id: episodes.id, entryId: episodes.entryId, seriesId: entries.seriesId })
      .from(episodes)
      .innerJoin(entries, eq(entries.id, episodes.entryId))
      .where(and(eq(episodes.id, episodeId), isNull(episodes.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async upsertProgress(
    userId: string,
    episode: { id: string; seriesId: string },
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
      .values({ userId, episodeId: episode.id, seriesId: episode.seriesId, ...values })
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

  /**
   * Every one of this viewer's progress rows for one series, keyed by
   * episode id — the bulk read an episode grid needs to show a
   * watched/in-progress state per card, as opposed to `findProgress`,
   * which is the single-episode read the watch page's own bootstrap
   * uses for the episode actually playing.
   */
  async progressForSeries(userId: string, seriesId: string): Promise<Map<string, EpisodeProgressRow>> {
    const rows = await this.db
      .select()
      .from(episodeProgress)
      .where(and(eq(episodeProgress.userId, userId), eq(episodeProgress.seriesId, seriesId)));
    return new Map(rows.map((row) => [row.episodeId, row]));
  }

  /**
   * The "continue watching" rail — Entry-aware: several seasons of the
   * same series can restart episode numbering from 1, so the specific
   * release (`entries`) the last-watched episode belongs to is returned
   * alongside the series, letting the UI render "Season 3 — Episode 8"
   * rather than an ambiguous bare episode number.
   */
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
        episodeSynopsis: episodes.synopsis,
        airedAt: episodes.airedAt,
        episodeDuration: episodes.durationSeconds,
        isFiller: episodes.isFiller,
        isRecap: episodes.isRecap,
        introStartSeconds: episodes.introStartSeconds,
        introEndSeconds: episodes.introEndSeconds,
        outroStartSeconds: episodes.outroStartSeconds,
        entryId: entries.id,
        entrySlug: entries.slug,
        entryTitle: entries.titleRomaji,
        entryType: entries.entryType,
        seasonNumber: entries.seasonNumber,
        courNumber: entries.courNumber,
        entryStatus: entries.status,
        ...seriesSelection,
      })
      .from(episodeProgress)
      .innerJoin(episodes, eq(episodes.id, episodeProgress.episodeId))
      .innerJoin(entries, eq(entries.id, episodes.entryId))
      .innerJoin(series, eq(series.id, episodeProgress.seriesId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.seriesId, series.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(and(eq(episodeProgress.userId, userId), eq(episodeProgress.isCompleted, false)))
      .orderBy(desc(episodeProgress.lastWatchedAt))
      .limit(limit);
  }
}
