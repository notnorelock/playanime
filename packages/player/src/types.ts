import type { NativePlayback, PlaybackDescriptor, PlaybackSource } from '@playanime/contracts';

/**
 * Generic player types.
 *
 * The player never knows how a provider resolved its streams. It only consumes
 * a `PlaybackDescriptor`.
 */

export type QualitySelection = 'auto' | number;

export interface PlayerQualityOption {
  readonly value: QualitySelection;
  readonly label: string;
}

export interface NativePlaybackState {
  readonly descriptor: NativePlayback;
  readonly selected: QualitySelection;
  readonly activeSource: PlaybackSource;
  readonly qualities: readonly PlayerQualityOption[];
}

export interface RefreshPlaybackResult {
  readonly descriptor: PlaybackDescriptor;
  readonly restoredPosition: number;
  readonly wasPlaying: boolean;
}

export interface NativeVideoAdapterOptions {
  readonly video: HTMLVideoElement;
  readonly maxRefreshAttempts?: number;
  readonly refreshPlayback: () => Promise<PlaybackDescriptor>;
  readonly onFallback?: (fallbackSrc: string) => void;
  readonly onError?: (error: unknown) => void;
}

export function qualityLabel(resolution: number): string {
  return `${String(resolution)}p`;
}

export function buildQualityOptions(sources: readonly PlaybackSource[]): readonly PlayerQualityOption[] {
  const resolutions = [
    ...new Set(
      sources
        .map((source) => source.resolution)
        .filter((value): value is number => typeof value === 'number' && value > 0),
    ),
  ].sort((a, b) => b - a);

  return [
    { value: 'auto', label: 'Auto' },
    ...resolutions.map((resolution) => ({ value: resolution, label: qualityLabel(resolution) })),
  ];
}

export function pickSource(
  sources: readonly PlaybackSource[],
  selected: QualitySelection,
): PlaybackSource {
  const first = sources[0];
  if (first === undefined) {
    throw new Error('Native playback requires at least one source.');
  }

  if (selected === 'auto') {
    return first;
  }

  const exact = sources.find((source) => source.resolution === selected);
  return exact ?? first;
}
