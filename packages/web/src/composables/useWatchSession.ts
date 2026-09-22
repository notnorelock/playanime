import { computed, ref, shallowRef } from 'vue';
import type {
  EpisodeSourceDto,
  EpisodeWatchBootstrap,
  PlaybackDescriptor,
} from '@playanime/contracts';
import { AbortError, ApiError, episodesApi } from '@/api';
import { toEntryCardModelFromWatch, toEpisodeCardModel, toSeriesModelFromWatch } from '@/models';

/**
 * Everything the watch page needs for one episode.
 *
 * The flow the backend defines is: bootstrap the episode (which returns the
 * title, adjacent episode ids, the viewer's progress and the ranked source
 * list), then resolve a `PlaybackDescriptor` for the chosen source. Both steps
 * live here so the view renders state rather than orchestrating requests.
 *
 * Requests are cancelled when superseded. Without that, switching episodes
 * quickly lets an earlier bootstrap resolve last and render the wrong episode.
 */
export function useWatchSession() {
  const bootstrap = shallowRef<EpisodeWatchBootstrap | null>(null);
  const descriptor = shallowRef<PlaybackDescriptor | null>(null);
  const selectedSourceId = ref<string | null>(null);

  const isLoading = ref(false);
  const isResolvingSource = ref(false);
  const error = ref<ApiError | Error | null>(null);
  /** Set when the episode loaded but no source would play. */
  const playbackError = ref<ApiError | Error | null>(null);

  let loadController: AbortController | null = null;

  const episode = computed(() =>
    bootstrap.value === null ? null : toEpisodeCardModel(bootstrap.value.episode, 'pl', bootstrap.value.progress),
  );
  /** The release this episode belongs to — "Season 2", "OVA 1" — for the watch header. */
  const entry = computed(() =>
    bootstrap.value === null ? null : toEntryCardModelFromWatch(bootstrap.value.entry),
  );
  /** The series the entry belongs to — "Attack on Titan" — for the watch header and "back to title" link. */
  const series = computed(() =>
    bootstrap.value === null ? null : toSeriesModelFromWatch(bootstrap.value.series),
  );
  const sources = computed<readonly EpisodeSourceDto[]>(() => bootstrap.value?.sources.sources ?? []);
  /** True when this episode loaded normally but playback is withheld pending an active VIP grant — see `EpisodeWatchBootstrap.vipRequired`'s own doc comment. Not an error: the page still has real title/synopsis/episode-list data. */
  const vipRequired = computed(() => bootstrap.value?.vipRequired ?? false);
  const previousEpisodeId = computed(() => bootstrap.value?.previousEpisodeId ?? null);
  const nextEpisodeId = computed(() => bootstrap.value?.nextEpisodeId ?? null);
  /** Where playback should resume, in seconds. */
  const resumePosition = computed(() => bootstrap.value?.progress?.positionSeconds ?? 0);

  const selectedSource = computed(
    () => sources.value.find((source) => source.id === selectedSourceId.value) ?? null,
  );

  /** Resolves a descriptor for the currently selected source. */
  async function resolvePlayback(episodeId: string, sourceId: string | null): Promise<void> {
    isResolvingSource.value = true;
    playbackError.value = null;

    try {
      const response = await episodesApi.playback(
        episodeId,
        sourceId ?? undefined,
        loadController?.signal,
      );
      descriptor.value = response.descriptor;
      selectedSourceId.value = response.sourceId;
    } catch (cause: unknown) {
      if (AbortError.is(cause)) return;
      descriptor.value = null;
      playbackError.value = cause instanceof Error ? cause : new Error('Nie udało się odtworzyć źródła.');
    } finally {
      isResolvingSource.value = false;
    }
  }

  /** Loads an episode and resolves playback for the server's recommended source. */
  async function load(episodeId: string): Promise<void> {
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;

    isLoading.value = true;
    error.value = null;
    playbackError.value = null;
    descriptor.value = null;
    selectedSourceId.value = null;

    try {
      const data = await episodesApi.bootstrap(episodeId, controller.signal);
      if (controller.signal.aborted) return;

      bootstrap.value = data;

      // A VIP-gated episode is not a playback failure — sources are
      // deliberately empty, and the view renders a VIP prompt instead of
      // the player rather than the generic "no source" error below.
      if (data.vipRequired) return;

      // The server ranks sources by verification, availability, language match
      // and provider reliability. Its recommendation is used as-is rather than
      // re-ranked here with less information.
      const recommended = data.sources.recommendedSourceId;
      if (recommended === null) {
        playbackError.value = new Error('Ten odcinek nie ma jeszcze dostępnego źródła.');
        return;
      }

      await resolvePlayback(episodeId, recommended);
    } catch (cause: unknown) {
      if (AbortError.is(cause)) return;
      bootstrap.value = null;
      error.value = cause instanceof Error ? cause : new Error('Nie udało się wczytać odcinka.');
    } finally {
      if (loadController === controller) {
        isLoading.value = false;
        loadController = null;
      }
    }
  }

  /** Switches to another source for the same episode. */
  async function selectSource(sourceId: string): Promise<void> {
    const current = bootstrap.value;
    if (current === null || sourceId === selectedSourceId.value) return;
    await resolvePlayback(current.episode.id, sourceId);
  }

  /**
   * Re-resolves the active source, bypassing the server cache.
   *
   * Handed to the player adapters so an expired signed URL is refreshed in
   * place, with the position restored, instead of surfacing as a media error.
   */
  async function refreshPlayback(): Promise<PlaybackDescriptor> {
    const sourceId = selectedSourceId.value;
    if (sourceId === null) throw new Error('Brak wybranego źródła do odświeżenia.');

    const response = await episodesApi.sourcePlayback(sourceId, { refresh: true });
    descriptor.value = response.descriptor;
    return response.descriptor;
  }

  function dispose(): void {
    loadController?.abort();
    loadController = null;
  }

  return {
    bootstrap,
    episode,
    entry,
    series,
    sources,
    vipRequired,
    selectedSource,
    selectedSourceId,
    descriptor,
    previousEpisodeId,
    nextEpisodeId,
    resumePosition,
    isLoading,
    isResolvingSource,
    error,
    playbackError,
    load,
    selectSource,
    refreshPlayback,
    dispose,
  };
}
