import type { EpisodeProgress, EpisodeSummary } from '@playanime/contracts';

/**
 * Episode presentation model.
 *
 * Progress is carried alongside the episode rather than fetched per card: the
 * watch bootstrap and the continue-watching rail both return it with the
 * episode, so a card never needs a request of its own.
 */
export interface EpisodeCardModel {
  readonly id: string;
  readonly animeId: string;
  readonly number: number;
  readonly title: string;
  readonly synopsis: string | null;
  readonly durationSeconds: number | null;
  readonly airedAt: string | null;
  readonly isFiller: boolean;
  readonly isRecap: boolean;
  /** 0-100, or null when the viewer has not started this episode. */
  readonly progressPercent: number | null;
  readonly isCompleted: boolean;
  readonly introStartSeconds: number | null;
  readonly introEndSeconds: number | null;
}

/** Percentage watched, or null when it cannot be computed honestly. */
export function progressPercent(
  positionSeconds: number,
  durationSeconds: number | null,
): number | null {
  if (durationSeconds === null || durationSeconds <= 0) return null;
  return Math.min(100, Math.max(0, (positionSeconds / durationSeconds) * 100));
}

export function toEpisodeCardModel(
  episode: EpisodeSummary,
  locale = 'pl',
  progress: EpisodeProgress | null = null,
): EpisodeCardModel {
  // Every episode needs a label; a numbered fallback beats an empty heading.
  const numberedFallback = `${locale.startsWith('pl') ? 'Odcinek' : 'Episode'} ${String(episode.number)}`

  return {
    id: episode.id,
    animeId: episode.animeId,
    number: episode.number,
    title: episode.title ?? numberedFallback,
    synopsis: episode.synopsis,
    durationSeconds: episode.durationSeconds,
    airedAt: episode.airedAt,
    isFiller: episode.isFiller,
    isRecap: episode.isRecap,
    progressPercent:
      progress === null
        ? null
        : progressPercent(progress.positionSeconds, progress.durationSeconds ?? episode.durationSeconds),
    isCompleted: progress?.isCompleted ?? false,
    introStartSeconds: episode.introStartSeconds,
    introEndSeconds: episode.introEndSeconds,
  };
}
