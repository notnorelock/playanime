import { db, EpisodeRepository } from '@playanime/database';
import { ErrorCode, NotFoundError } from '@playanime/shared';
import type { RequestSession } from '../../plugins/session.js';
import { listSources } from '../sources/sources.service.js';
import { toWatchAnime, toWatchEpisode } from './watch.mapper.js';

const repository = new EpisodeRepository(db());

export async function getWatchBootstrap(episodeId: string, session: RequestSession | null) {
  const row = await repository.findWatchEpisode(episodeId);
  if (row === null || (row.isAdult && !session?.preferences.showMatureContent)) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }
  const [adjacent, progress, sources] = await Promise.all([
    repository.adjacent(row.animeId, row.number),
    session === null ? null : repository.progress(session.user.id, row.id),
    listSources(row.id, {
      preferredAudioLanguage: session?.preferences.preferredAudioLanguage ?? null,
      preferredSubtitleLanguage: session?.preferences.preferredSubtitleLanguage ?? null,
    }),
  ]);
  return {
    episode: toWatchEpisode(row),
    anime: toWatchAnime(row),
    previousEpisodeId: adjacent.previousId,
    nextEpisodeId: adjacent.nextId,
    progress: progress === null ? null : { ...progress, lastWatchedAt: progress.lastWatchedAt.toISOString() },
    sources,
  };
}
