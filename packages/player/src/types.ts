import type {
  HlsPlayback,
  NativePlayback,
  PlaybackDescriptor,
  PlaybackSource,
} from '@playanime/contracts';

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

/**
 * Minimal structural view of an hls.js instance.
 *
 * Declared structurally so `@playanime/player` does not take a hard dependency
 * on hls.js types: a host app passes its own already-loaded implementation.
 */
export interface HlsEngine {
  loadSource(src: string): void;
  attachMedia(video: HTMLVideoElement): void;
  destroy(): void;
  on(event: string, handler: (event: string, data: unknown) => void): void;
  /** -1 selects the adaptive ladder. */
  currentLevel: number;
  levels: readonly { readonly height?: number; readonly bitrate?: number }[];
}

export interface HlsEngineFactory {
  /** Whether hls.js can run here. False on Safari, which plays HLS natively. */
  isSupported(): boolean;
  create(): HlsEngine;
}

export interface HlsVideoAdapterOptions {
  readonly video: HTMLVideoElement;
  /**
   * hls.js provider. Omitted when the browser plays HLS natively (Safari),
   * where the adapter assigns the playlist straight to `video.src`.
   */
  readonly engine?: HlsEngineFactory;
  readonly refreshPlayback?: () => Promise<PlaybackDescriptor>;
  readonly onFallback?: (fallbackSrc: string) => void;
  readonly onError?: (error: unknown) => void;
}

export interface HlsPlaybackState {
  readonly descriptor: HlsPlayback;
  readonly selected: QualitySelection;
  readonly qualities: readonly PlayerQualityOption[];
}

/**
 * Quality options for an adaptive stream.
 *
 * Built from the variants the provider advertised, so the menu matches the
 * ladder rather than inventing labels. `Auto` is always first: for adaptive
 * playback it is the correct default, not a placeholder.
 */
export function buildHlsQualityOptions(
  descriptor: HlsPlayback,
): readonly PlayerQualityOption[] {
  const resolutions = [
    ...new Set((descriptor.variants ?? []).map((variant) => variant.resolution)),
  ].sort((a, b) => b - a);

  return [
    { value: 'auto', label: 'Auto' },
    ...resolutions.map((resolution) => ({ value: resolution, label: qualityLabel(resolution) })),
  ];
}

/** Whether the browser can play HLS without hls.js (Safari / iOS). */
export function canPlayHlsNatively(video: HTMLVideoElement): boolean {
  return (
    video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    video.canPlayType('application/x-mpegURL') !== ''
  );
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
