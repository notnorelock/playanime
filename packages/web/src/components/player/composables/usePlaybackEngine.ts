import { computed, ref, shallowRef, type Ref } from 'vue';
import Hls from 'hls.js';
import type { PlaybackDescriptor } from '@playanime/contracts';
import {
  HlsVideoAdapter,
  NativeVideoAdapter,
  type HlsEngine,
  type HlsEngineFactory,
  type PlayerQualityOption,
  type QualitySelection,
} from '@playanime/player';

/**
 * Binds a `PlaybackDescriptor` to a `<video>` element.
 *
 * All the provider-specific work — deciding whether a source is HLS, native or
 * an iframe, building the quality ladder, refreshing an expired signed URL —
 * already exists in `@playanime/player`, which the API and the web app share.
 * This composable is only the Vue lifecycle around it: it owns exactly one
 * adapter at a time and disposes of it whenever the descriptor changes.
 *
 * That single-ownership rule is the point. The previous player created an
 * hls.js instance per source change without destroying the last one, which
 * leaked a media pipeline and a set of listeners on every episode switch.
 */

/**
 * Adapts hls.js to the structural interface `@playanime/player` expects.
 *
 * Declared here rather than in the player package so that package keeps no
 * dependency on a specific HLS implementation.
 */
const hlsEngineFactory: HlsEngineFactory = {
  isSupported: () => Hls.isSupported(),
  create: (): HlsEngine => {
    const instance = new Hls({
      enableWorker: true,
      // Capped to the element's size: fetching a 4K ladder into a 600px player
      // wastes the viewer's bandwidth for no visible gain.
      capLevelToPlayerSize: true,
      startLevel: -1,
    });

    return {
      loadSource: (src) => {
        instance.loadSource(src);
      },
      attachMedia: (video) => {
        instance.attachMedia(video);
      },
      destroy: () => {
        instance.destroy();
      },
      on: (event, handler) => {
        // The adapter subscribes with hls.js' own event names.
        instance.on(event as Parameters<typeof instance.on>[0], ((
          eventName: string,
          data: unknown,
        ) => {
          handler(eventName, data);
        }) as never);
      },
      get currentLevel() {
        return instance.currentLevel;
      },
      set currentLevel(level: number) {
        instance.currentLevel = level;
      },
      get levels() {
        return instance.levels.map((level) => ({ height: level.height, bitrate: level.bitrate }));
      },
    };
  },
};

export interface UsePlaybackEngineOptions {
  /** Re-resolves the current source. Used when a temporary URL expires. */
  readonly refreshPlayback: () => Promise<PlaybackDescriptor>;
  readonly onError?: (error: unknown) => void;
}

export function usePlaybackEngine(
  videoElement: Ref<HTMLVideoElement | undefined>,
  options: UsePlaybackEngineOptions,
) {
  const descriptor = shallowRef<PlaybackDescriptor | null>(null);
  const qualities = ref<readonly PlayerQualityOption[]>([]);
  const selectedQuality = ref<QualitySelection>('auto');
  const isLoading = ref(false);
  /** Set when the adapter gives up on native playback and offers an iframe. */
  const fallbackIframeSrc = ref<string | null>(null);

  // shallowRef: an adapter is a class instance with its own internal state, and
  // making it deeply reactive would have Vue proxy the HTMLVideoElement it holds.
  const adapter = shallowRef<NativeVideoAdapter | HlsVideoAdapter | null>(null);

  /** True when the descriptor cannot be played in-page at all. */
  const isEmbedded = computed(
    () => descriptor.value?.type === 'iframe' || fallbackIframeSrc.value !== null,
  );

  function disposeAdapter(): void {
    adapter.value?.destroy();
    adapter.value = null;
  }

  function handleFallback(src: string): void {
    fallbackIframeSrc.value = src;
    // The native pipeline is finished with once the iframe takes over; leaving
    // it attached would keep buffering a stream nobody can see.
    disposeAdapter();
    isLoading.value = false;
  }

  /**
   * Loads a descriptor.
   *
   * Every call tears the previous adapter down first, so switching source,
   * quality or episode can never leave two engines attached to one element.
   */
  async function load(next: PlaybackDescriptor, resumeAt?: number): Promise<void> {
    disposeAdapter();
    fallbackIframeSrc.value = null;
    descriptor.value = next;
    qualities.value = [];
    selectedQuality.value = 'auto';

    // These variants are rendered by the component, not driven by an adapter.
    if (next.type === 'iframe' || next.type === 'external' || next.type === 'unavailable') {
      isLoading.value = false;
      return;
    }

    const video = videoElement.value;
    if (video === undefined) return;

    isLoading.value = true;

    try {
      if (next.type === 'hls') {
        const hlsAdapter = new HlsVideoAdapter({
          video,
          engine: hlsEngineFactory,
          refreshPlayback: options.refreshPlayback,
          onFallback: handleFallback,
          ...(options.onError === undefined ? {} : { onError: options.onError }),
        });

        adapter.value = hlsAdapter;
        hlsAdapter.load(next, resumeAt);
        qualities.value = hlsAdapter.qualities;
        return;
      }

      const nativeAdapter = new NativeVideoAdapter({
        video,
        refreshPlayback: options.refreshPlayback,
        onFallback: handleFallback,
        ...(options.onError === undefined ? {} : { onError: options.onError }),
      });

      adapter.value = nativeAdapter;
      await nativeAdapter.load(next, resumeAt);
      qualities.value = nativeAdapter.qualities;
    } finally {
      isLoading.value = false;
    }
  }

  async function setQuality(selection: QualitySelection): Promise<void> {
    const current = adapter.value;
    if (current === null) return;

    selectedQuality.value = selection;

    if (current instanceof NativeVideoAdapter) {
      await current.setQuality(selection);
      return;
    }

    current.setQuality(selection);
  }

  return {
    descriptor,
    qualities,
    selectedQuality,
    isLoading,
    fallbackIframeSrc,
    isEmbedded,
    load,
    setQuality,
    dispose: disposeAdapter,
  };
}
