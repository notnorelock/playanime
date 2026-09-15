import type { HlsPlayback, PlaybackDescriptor } from '@playanime/contracts';
import {
  buildHlsQualityOptions,
  canPlayHlsNatively,
  type HlsEngine,
  type HlsVideoAdapterOptions,
  type PlayerQualityOption,
  type QualitySelection,
} from './types.js';

/**
 * Adaptive HLS playback adapter.
 *
 * Knows nothing about Rumble, or any other provider. It receives an `hls`
 * descriptor, hands the master playlist to hls.js (or to the browser where HLS
 * is native), and exposes the ladder for manual quality selection.
 *
 * Two deliberate choices:
 *
 * - The master playlist is loaded as-is. Segments are never expanded or
 *   rewritten; the adaptive ladder is the provider's, and copying it into our
 *   own logic would only add a way to get it wrong.
 * - A fatal load error falls back to the descriptor's iframe when one exists,
 *   rather than retrying forever. For a provider-restricted stream the iframe
 *   is the outcome the provider intends.
 */
export class HlsVideoAdapter {
  private readonly video: HTMLVideoElement;
  private readonly engineFactory: HlsVideoAdapterOptions['engine'];
  private readonly onFallback: ((fallbackSrc: string) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;

  private descriptor: HlsPlayback | null = null;
  private engine: HlsEngine | null = null;
  private selected: QualitySelection = 'auto';
  private pendingResume: (() => void) | null = null;

  constructor(options: HlsVideoAdapterOptions) {
    this.video = options.video;
    this.engineFactory = options.engine;
    this.onFallback = options.onFallback ?? undefined;
    this.onError = options.onError ?? undefined;
  }

  destroy(): void {
    this.detachEngine();
  }

  get qualities(): readonly PlayerQualityOption[] {
    if (this.descriptor === null) return [];
    return buildHlsQualityOptions(this.descriptor);
  }

  get selection(): QualitySelection {
    return this.selected;
  }

  get currentDescriptor(): HlsPlayback | null {
    return this.descriptor;
  }

  /** True when playback is driven by hls.js rather than the browser. */
  get usesEngine(): boolean {
    return this.engine !== null;
  }

  load(descriptor: PlaybackDescriptor, resumeAt?: number): void {
    if (descriptor.type !== 'hls') {
      if (descriptor.type === 'iframe') {
        this.onFallback?.(descriptor.url);
        return;
      }
      throw new Error(`HlsVideoAdapter cannot load descriptor type "${descriptor.type}".`);
    }

    this.detachEngine();
    this.descriptor = descriptor;

    // Safari plays HLS natively and does so more efficiently than hls.js.
    if (this.engineFactory?.isSupported() !== true) {
      if (!canPlayHlsNatively(this.video)) {
        this.useFallback();
        return;
      }
      this.video.src = descriptor.src;
      this.applyResume(resumeAt);
      return;
    }

    const engine = this.engineFactory.create();
    this.engine = engine;

    engine.on('hlsError', (_event, data) => {
      if (isFatalHlsError(data)) {
        this.onError?.(data);
        this.useFallback();
      }
    });

    engine.loadSource(descriptor.src);
    engine.attachMedia(this.video);
    this.applyResume(resumeAt);
  }

  /**
   * Pins the ladder to one rendition, or returns to adaptive.
   *
   * Matching is by height so the menu stays in terms of the resolutions the
   * provider advertised. An unmatched selection falls back to adaptive rather
   * than locking playback to an arbitrary level.
   */
  setQuality(selection: QualitySelection): void {
    this.selected = selection;

    // Some providers resolve one playlist per quality instead of advertising
    // all levels inside a master. Switching those requires loading its URL;
    // assigning an hls.js level index would leave the old playlist playing.
    const descriptor = this.descriptor;
    if (descriptor?.sources !== undefined) {
      const source =
        selection === 'auto'
          ? undefined
          : descriptor.sources.find((candidate) => candidate.resolution === selection);
      const position = this.video.currentTime;
      const wasPlaying = !this.video.paused;
      this.load({ ...descriptor, src: source?.src ?? descriptor.src }, position);
      // Keep the original default URL so Auto can restore it after a switch.
      this.descriptor = descriptor;
      if (wasPlaying) void this.video.play().catch((error: unknown) => this.onError?.(error));
      return;
    }

    const engine = this.engine;
    if (engine === null) {
      // Native HLS: the browser owns rendition choice. Recording the selection
      // keeps the menu honest instead of pretending we applied it.
      return;
    }

    if (selection === 'auto') {
      engine.currentLevel = -1;
      return;
    }

    const index = engine.levels.findIndex((level) => level.height === selection);
    engine.currentLevel = index >= 0 ? index : -1;
  }

  private applyResume(resumeAt: number | undefined): void {
    if (resumeAt === undefined || !Number.isFinite(resumeAt) || resumeAt <= 0) return;
    // Live edge streams have no meaningful resume point.
    if (this.descriptor?.live === true) return;

    const seek = (): void => {
      try {
        this.video.currentTime = resumeAt;
      } catch {
        // Seeking before enough of the playlist is buffered is not an error.
      }
    };

    const onLoaded = (): void => {
      this.video.removeEventListener('loadedmetadata', onLoaded);
      this.pendingResume = null;
      seek();
    };
    // A previous playlist can still report readyState > 0 during a switch.
    // Seek again when the replacement metadata arrives, then remove the hook.
    this.pendingResume = onLoaded;
    this.video.addEventListener('loadedmetadata', onLoaded);
    if (this.video.readyState > 0) seek();
  }

  private detachEngine(): void {
    if (this.pendingResume !== null) {
      this.video.removeEventListener('loadedmetadata', this.pendingResume);
      this.pendingResume = null;
    }
    if (this.engine === null) return;
    try {
      this.engine.destroy();
    } catch (error) {
      this.onError?.(error);
    }
    this.engine = null;
  }

  private useFallback(): void {
    const fallback = this.descriptor?.fallback;
    if (fallback !== undefined) this.onFallback?.(fallback.src);
  }
}

function isFatalHlsError(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { fatal?: unknown }).fatal === true;
}
