import type { NativePlayback, PlaybackDescriptor } from '@playanime/contracts';
import {
  buildQualityOptions,
  pickSource,
  type NativeVideoAdapterOptions,
  type PlayerQualityOption,
  type QualitySelection,
  type RefreshPlaybackResult,
} from './types.js';

/**
 * Native HTML5 playback adapter.
 *
 * Knows nothing about Google Drive. Receives a descriptor, renders qualities
 * that were actually resolved, and can request a fresh descriptor when a
 * temporary URL expires — restoring position afterwards.
 */
export class NativeVideoAdapter {
  private readonly video: HTMLVideoElement;
  private readonly refreshPlayback: () => Promise<PlaybackDescriptor>;
  private readonly onFallback: ((fallbackSrc: string) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly maxRefreshAttempts: number;

  private descriptor: NativePlayback | null = null;
  private selected: QualitySelection = 'auto';
  private refreshAttempts = 0;
  private refreshing = false;
  private readonly onVideoError = (): void => {
    void this.handleMediaError();
  };

  constructor(options: NativeVideoAdapterOptions) {
    this.video = options.video;
    this.refreshPlayback = options.refreshPlayback;
    this.onFallback = options.onFallback ?? undefined;
    this.onError = options.onError ?? undefined;
    this.maxRefreshAttempts = options.maxRefreshAttempts ?? 2;
    this.video.addEventListener('error', this.onVideoError);
  }

  destroy(): void {
    this.video.removeEventListener('error', this.onVideoError);
  }

  get qualities(): readonly PlayerQualityOption[] {
    if (this.descriptor === null) return [];
    return buildQualityOptions(this.descriptor.sources);
  }

  get selection(): QualitySelection {
    return this.selected;
  }

  get currentDescriptor(): NativePlayback | null {
    return this.descriptor;
  }

  async load(descriptor: PlaybackDescriptor, resumeAt?: number): Promise<void> {
    if (descriptor.type !== 'native') {
      if (descriptor.type === 'iframe') {
        this.onFallback?.(descriptor.url);
        return;
      }
      throw new Error(`NativeVideoAdapter cannot load descriptor type "${descriptor.type}".`);
    }

    this.descriptor = descriptor;
    this.refreshAttempts = 0;
    await this.applySource(this.selected, resumeAt, !this.video.paused);
  }

  async setQuality(selection: QualitySelection): Promise<void> {
    if (this.descriptor === null) return;
    const position = this.video.currentTime;
    const wasPlaying = !this.video.paused;
    this.selected = selection;
    await this.applySource(selection, position, wasPlaying);
  }

  async refreshAndRestore(): Promise<RefreshPlaybackResult | null> {
    if (this.refreshing) return null;
    if (this.refreshAttempts >= this.maxRefreshAttempts) {
      this.useFallback();
      return null;
    }

    this.refreshing = true;
    this.refreshAttempts += 1;

    const position = this.video.currentTime;
    const wasPlaying = !this.video.paused;

    try {
      const next = await this.refreshPlayback();
      await this.load(next, position);
      if (wasPlaying) {
        try {
          await this.video.play();
        } catch (error) {
          this.onError?.(error);
        }
      }
      return { descriptor: next, restoredPosition: position, wasPlaying };
    } catch (error) {
      this.onError?.(error);
      this.useFallback();
      return null;
    } finally {
      this.refreshing = false;
    }
  }

  private async applySource(
    selection: QualitySelection,
    resumeAt: number | undefined,
    shouldPlay: boolean,
  ): Promise<void> {
    if (this.descriptor === null) return;

    const source = pickSource(this.descriptor.sources, selection);
    this.video.src = source.src;
    if (source.mimeType !== undefined) {
      this.video.setAttribute('type', source.mimeType);
    }

    await new Promise<void>((resolve) => {
      const onLoaded = (): void => {
        this.video.removeEventListener('loadedmetadata', onLoaded);
        resolve();
      };
      this.video.addEventListener('loadedmetadata', onLoaded);
      this.video.load();
    });

    if (resumeAt !== undefined && Number.isFinite(resumeAt) && resumeAt > 0) {
      try {
        this.video.currentTime = resumeAt;
      } catch {
        // Some providers reject seeks until more data is buffered.
      }
    }

    if (shouldPlay) {
      try {
        await this.video.play();
      } catch (error) {
        this.onError?.(error);
      }
    }
  }

  private async handleMediaError(): Promise<void> {
    const mediaError = this.video.error;
    // MEDIA_ERR_SRC_NOT_SUPPORTED / NETWORK often indicate an expired signed URL.
    if (mediaError === null) return;
    if (mediaError.code !== mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && mediaError.code !== mediaError.MEDIA_ERR_NETWORK) {
      this.onError?.(mediaError);
      return;
    }

    await this.refreshAndRestore();
  }

  private useFallback(): void {
    const fallback = this.descriptor?.fallback;
    if (fallback !== undefined) {
      this.onFallback?.(fallback.src);
    }
  }
}
