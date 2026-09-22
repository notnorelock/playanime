import { db, EpisodeRepository } from '@playanime/database';
import { ErrorCode, NotFoundError } from '@playanime/shared';
import type { RequestSession } from '../../plugins/session.js';
import { listSources } from '../sources/sources.service.js';
import { toWatchEntry, toWatchEpisode, toWatchSeries } from './watch.mapper.js';

const repository = new EpisodeRepository(db());

export async function getWatchBootstrap(episodeId: string, session: RequestSession | null) {
  const row = await repository.findWatchEpisode(episodeId);
  if (row === null || (row.isAdult && !session?.preferences.showMatureContent)) {
    throw new NotFoundError('Nie znaleziono tego odcinka.', {
      code: ErrorCode.EPISODE_NOT_FOUND,
    });
  }

  const isVip = session?.isVip ?? false;
  const requiresVip =
    !isVip && (row.vipOnly || (row.earlyAccessUntil !== null && row.earlyAccessUntil > new Date()));

  const [adjacent, progress, sources] = await Promise.all([
    repository.adjacent(row.entryId, row.number),
    session === null ? null : repository.progress(session.user.id, row.id),
    // Metadata (title, synopsis, episode list, ...) stays visible either
    // way — only playback sources are withheld. This is deliberately not
    // a 404 the way isAdult gating is; the page loads and the frontend
    // shows a VIP-required prompt where the player would be.
    requiresVip
      ? Promise.resolve({ episodeId: row.id, sources: [], recommendedSourceId: null })
      : listSources(row.id, {
          preferredAudioLanguage: session?.preferences.preferredAudioLanguage ?? null,
          preferredSubtitleLanguage: session?.preferences.preferredSubtitleLanguage ?? null,
        }),
  ]);
  const mappedProgress =
    progress === null ? null : { ...progress, lastWatchedAt: progress.lastWatchedAt.toISOString() };

  return {
    episode: { ...toWatchEpisode(row, requiresVip), progress: mappedProgress },
    entry: toWatchEntry(row),
    series: toWatchSeries(row),
    previousEpisodeId: adjacent.previousId,
    nextEpisodeId: adjacent.nextId,
    progress: mappedProgress,
    vipRequired: requiresVip,
    sources,
  };
}
