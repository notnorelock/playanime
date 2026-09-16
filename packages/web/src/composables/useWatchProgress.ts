import { onBeforeUnmount, ref } from 'vue';
import { libraryApi } from '@/api';

/**
 * Persists playback position to the backend.
 *
 * Progress is reported on a schedule and at the moments that matter — pause,
 * seek, end, and leaving the page — never per `timeupdate`, which fires roughly
 * four times a second and would turn one viewer into a sustained write load.
 *
 * Writes are server-side only. A local mirror would go stale and then overwrite
 * the record that other devices depend on.
 */

/** Seconds between periodic saves while playing. */
const SAVE_INTERVAL_SECONDS = 15;
/** Below this, a position is a mis-click rather than progress worth storing. */
const MINIMUM_POSITION_SECONDS = 5;

export interface UseWatchProgressOptions {
  /** Called with the episode id, or null when nothing is loaded. */
  readonly episodeId: () => string | null;
  readonly durationSeconds: () => number | null;
  /** Whether the viewer is signed in; anonymous progress is not stored. */
  readonly enabled: () => boolean;
}

export function useWatchProgress(options: UseWatchProgressOptions) {
  const isSaving = ref(false);
  const lastError = ref<unknown>(null);

  let lastSavedPosition = 0;
  let lastSavedAt = 0;
  let inFlight: Promise<void> | null = null;

  function reset(): void {
    lastSavedPosition = 0;
    lastSavedAt = 0;
  }

  async function save(positionSeconds: number, completed: boolean): Promise<void> {
    const episodeId = options.episodeId();
    if (episodeId === null || !options.enabled()) return;

    const position = Math.floor(positionSeconds);
    if (position < MINIMUM_POSITION_SECONDS && !completed) return;

    // One write at a time: overlapping upserts for the same row can otherwise
    // land out of order and store an older position than the one already saved.
    if (inFlight !== null) return inFlight;

    isSaving.value = true;
    lastError.value = null;

    const duration = options.durationSeconds();

    inFlight = libraryApi
      .saveProgress(episodeId, {
        positionSeconds: position,
        ...(duration === null ? {} : { durationSeconds: Math.floor(duration) }),
        ...(completed ? { isCompleted: true } : {}),
      })
      .then(() => {
        lastSavedPosition = position;
        lastSavedAt = Date.now();
      })
      .catch((error: unknown) => {
        // A failed progress write must never interrupt playback; it is recorded
        // and retried on the next tick.
        lastError.value = error;
      })
      .finally(() => {
        isSaving.value = false;
        inFlight = null;
      });

    return inFlight;
  }

  /**
   * Called on every `timeupdate`. Cheap by design: it does arithmetic and
   * usually returns, saving only once the interval has elapsed.
   */
  function onTimeUpdate(positionSeconds: number): void {
    if (!options.enabled()) return;

    const elapsed = (Date.now() - lastSavedAt) / 1000;
    if (elapsed < SAVE_INTERVAL_SECONDS) return;
    // Rewinding is a legitimate position change and must be stored, but an
    // identical position is not worth a request.
    if (Math.floor(positionSeconds) === lastSavedPosition) return;

    void save(positionSeconds, false);
  }

  /** Discrete events worth a write regardless of the interval. */
  function onPause(positionSeconds: number): void {
    void save(positionSeconds, false);
  }

  function onSeeked(positionSeconds: number): void {
    void save(positionSeconds, false);
  }

  function onEnded(positionSeconds: number): void {
    void save(positionSeconds, true);
  }

  /**
   * Final write before the view is torn down.
   *
   * Uses the same endpoint rather than `sendBeacon`: the API requires the CSRF
   * header on mutations, which a beacon cannot set.
   */
  function flush(positionSeconds: number): Promise<void> {
    return save(positionSeconds, false) ?? Promise.resolve();
  }

  onBeforeUnmount(() => {
    inFlight = null;
  });

  return { isSaving, lastError, onTimeUpdate, onPause, onSeeked, onEnded, flush, reset };
}
