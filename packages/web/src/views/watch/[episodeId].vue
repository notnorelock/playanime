<script setup lang="ts">
/**
 * Watch page.
 *
 * Routed by episode id alone. The old route carried an anime id as well, but
 * the episode's title, its neighbours and the viewer's progress all come back
 * with the episode from one bootstrap call, so the second parameter only
 * created a way for the URL to contradict the data.
 *
 * The flow is: bootstrap the episode, resolve a `PlaybackDescriptor` for the
 * server's recommended source, render it. Switching source re-resolves; nothing
 * about a provider is decided here.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ChevronLeft, List, Check, Download, Crown } from 'lucide-vue-next'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useApiError } from '@/composables/useApiError'
import { useToast } from '@/composables/useToast'
import { useWatchSession } from '@/composables/useWatchSession'
import { useWatchProgress } from '@/composables/useWatchProgress'
import { useAuthStore } from '@/store/auth'
import { animeApi } from '@/api'
import { toEpisodeCardModel, type EpisodeCardModel } from '@/models'
import Button from '@/components/ui/Button.vue'
import VideoPlayer from '@/components/player/VideoPlayerAsync.vue'
import VideoPlayerSkeleton from '@/components/player/VideoPlayerSkeleton.vue'
import SourceSelector from '@/components/player/SourceSelector.vue'
import EpisodeNavigation from '@/components/features/EpisodeNavigation.vue'
import EpisodeGrid from '@/components/features/EpisodeGrid.vue'
import EpisodeCredits from '@/components/features/EpisodeCredits.vue'
import EpisodeRating from '@/components/features/Rating/EpisodeRating.vue'
import CommentList from '@/components/features/Comments/CommentList.vue'

const route = useRoute('/watch/[episodeId]')
const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const session = useWatchSession()
const showEpisodeList = ref(false)
const siblingEpisodes = ref<EpisodeCardModel[]>([])

/** Current playhead, mirrored so progress can be flushed on navigation. */
const currentPosition = ref(0)

const progress = useWatchProgress({
  episodeId: () => session.bootstrap.value?.episode.id ?? null,
  durationSeconds: () =>
    session.bootstrap.value?.episode.durationSeconds ?? null,
  enabled: () => authStore.isAuthenticated
})

/** "Attack on Titan — Season 2" for a series with more than one entry; just the series title for a single-entry one. */
const titleWithEntry = computed(() => {
  const series = session.series.value
  const entry = session.entry.value
  if (series === null) return null
  if (entry === null || entry.isMainEntry) return series.title
  return `${series.title} — ${entry.title}`
})

const pageTitle = computed(() => {
  const episode = session.episode.value
  const label = titleWithEntry.value
  if (episode === null || label === null) return t('common.loading')
  return t('pageTitle.episode', {
    anime: label,
    number: episode.number,
    title: episode.title
  })
})
usePageTitle(() => pageTitle.value)

const playbackErrorMessage = computed(() =>
  session.playbackError.value === null ? null : translateError(session.playbackError.value)
)

/**
 * Whether the viewer has already clicked "mark as watched" for the CURRENT
 * source. Reset whenever the descriptor itself changes, so switching
 * episodes (or a fallback swapping in a different provider) shows the
 * button again rather than carrying a stale "watched" state over from a
 * previous source.
 *
 * Shown regardless of surface type — not only for a sandboxed iframe embed.
 * A real `<video>` source already reports genuine progress/`ended` events,
 * but a viewer stopping short of the true end (or one who just wants to
 * force completion without watching to the last second) still benefits from
 * the same manual override iframe sources have always had.
 */
const markedWatched = ref(false)
watch(
  () => session.descriptor.value,
  () => {
    markedWatched.value = false
  }
)

/**
 * A direct-download link for the current source, when the provider
 * documents one (Byse today — see `IframePlayback.downloadUrl`'s own doc
 * comment in @playanime/contracts). Server-constructed exactly like the
 * embed URL itself; this view never builds a provider URL on its own.
 */
const downloadUrl = computed(() => {
  const descriptor = session.descriptor.value
  return descriptor?.type === 'iframe' ? (descriptor.downloadUrl ?? null) : null
})

/**
 * Sibling episodes for the in-page list — scoped to the current Entry, not
 * the whole series: several seasons of the same series can restart episode
 * numbering from 1, so mixing them into one list would be actively
 * misleading. `entryId === undefined` (the main entry, matched by not
 * having its own slug in the bootstrap) uses the series-level route for
 * URL/back-compat; any other entry uses the entry-scoped one.
 */
async function loadSiblings(seriesSlug: string, entryId: string, isMainEntry: boolean): Promise<void> {
  try {
    const episodes = isMainEntry
      ? await animeApi.episodes(seriesSlug)
      : await animeApi.entryEpisodes(seriesSlug, entryId)
    siblingEpisodes.value = episodes.map((episode) => toEpisodeCardModel(episode))
  } catch (cause: unknown) {
    // The list is a convenience; previous/next navigation comes from the
    // bootstrap and keeps working without it.
    console.error('Failed to load the episode list:', cause)
  }
}

async function loadEpisode(episodeId: string): Promise<void> {
  progress.reset()
  currentPosition.value = 0

  const previousEntryId = session.entry.value?.id
  await session.load(episodeId)

  // A different entry means the cached episode list no longer applies —
  // cleared before the sibling fetch below so its own `length === 0`
  // reload guard fires for the new entry.
  if (session.entry.value?.id !== previousEntryId) siblingEpisodes.value = []

  const seriesSlug = session.series.value?.slug
  const entry = session.entry.value
  if (seriesSlug !== undefined && entry !== null && siblingEpisodes.value.length === 0) {
    void loadSiblings(seriesSlug, entry.id, entry.isMainEntry)
  }
}

onMounted(() => {
  void loadEpisode(route.params.episodeId)
})

// Navigating between episodes reuses this component. The watcher drives the
// reload, and `useWatchSession` aborts the superseded request so a slow earlier
// bootstrap cannot land after a faster later one.
watch(
  () => route.params.episodeId,
  (episodeId, previous) => {
    if (typeof episodeId !== 'string' || episodeId === previous) return
    // The outgoing episode's position is worth keeping.
    void progress.flush(currentPosition.value)
    void loadEpisode(episodeId)
  }
)

onBeforeRouteLeave(() => {
  void progress.flush(currentPosition.value)
})

onBeforeUnmount(() => {
  session.dispose()
})

/* -------------------------------------------------------------------------- */
/* Player events                                                               */
/* -------------------------------------------------------------------------- */

function handleTimeUpdate(time: number): void {
  currentPosition.value = time
  progress.onTimeUpdate(time)
}

function handlePaused(time: number): void {
  currentPosition.value = time
  progress.onPause(time)
}

function handleSeeked(time: number): void {
  currentPosition.value = time
  progress.onSeeked(time)
}

function handleEnded(time: number): void {
  progress.onEnded(time)

  const next = session.nextEpisodeId.value
  if (next !== null) void router.push({ name: '/watch/[episodeId]', params: { episodeId: next } })
}

/**
 * The viewer confirmed they finished an embedded (iframe) source — the
 * only completion signal available for one, since a third-party embed
 * reports no playback events to this page at all. Reuses `onEnded`
 * (marks complete regardless of position), the episode's own known
 * duration standing in for a real playhead position since there isn't
 * one. Deliberately does NOT auto-advance to the next episode the way
 * a real `ended` event does — this is a manual click, not a natural
 * end of playback, so the viewer should stay in control of when they
 * move on.
 */
function handleMarkedWatched(): void {
  if (!authStore.isAuthenticated) {
    toast.error(t('player.markAsWatchedRequiresAuth'))
    return
  }

  markedWatched.value = true

  const durationSeconds = session.bootstrap.value?.episode.durationSeconds ?? 0
  progress.onEnded(durationSeconds)
  toast.success(t('player.markedAsWatchedToast'))
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

const playEpisode = (episodeId: string) => {
  void router.push({ name: '/watch/[episodeId]', params: { episodeId } })
}

const playPrevious = () => {
  const previous = session.previousEpisodeId.value
  if (previous !== null) playEpisode(previous)
}

const playNext = () => {
  const next = session.nextEpisodeId.value
  if (next !== null) playEpisode(next)
}

const goToTitle = () => {
  const slug = session.series.value?.slug
  if (slug !== undefined) void router.push({ name: '/anime/[slug]', params: { slug } })
  else void router.push({ name: '/' })
}

const selectSource = (sourceId: string) => {
  void session.selectSource(sourceId)
}
</script>

<template>
  <div class="watch-page bg-dark-900 min-h-screen">
    <!-- Player -->
    <VideoPlayerSkeleton v-if="session.isLoading.value" />

    <div
      v-else-if="session.error.value"
      class="container mx-auto px-4 py-24 text-center"
    >
      <h1 class="text-2xl font-bold text-text-primary mb-4">
        {{ translateError(session.error.value) }}
      </h1>
      <Button variant="glass" @click="router.push({ name: '/' })">
        {{ t('common.backToHome') }}
      </Button>
    </div>

    <template v-else-if="session.episode.value && session.series.value && session.entry.value">
      <VideoPlayer
        v-if="session.descriptor.value"
        :key="`${session.episode.value.id}:${session.selectedSourceId.value ?? 'none'}`"
        :descriptor="session.descriptor.value"
        :poster="session.entry.value.posterUrl"
        :autoplay="true"
        :resume-at="session.resumePosition.value"
        :intro-start-seconds="session.episode.value.introStartSeconds"
        :intro-end-seconds="session.episode.value.introEndSeconds"
        :refresh-playback="session.refreshPlayback"
        @time-update="handleTimeUpdate"
        @paused="handlePaused"
        @seeked="handleSeeked"
        @ended="handleEnded"
      />

      <!-- VIP-gated: the episode loaded normally, playback is withheld. -->
      <div
        v-else-if="session.vipRequired.value"
        class="w-full aspect-video bg-dark-800 flex flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div class="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
          <Crown :size="32" class="text-primary" />
        </div>
        <h2 class="text-xl font-semibold text-text-primary">
          {{ t('player.vipRequiredTitle') }}
        </h2>
        <p class="text-text-secondary max-w-md">
          {{ t('player.vipRequiredBody') }}
        </p>
      </div>

      <!-- No playable source, or resolution failed. -->
      <div
        v-else
        class="w-full aspect-video bg-dark-800 flex flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <p class="text-text-secondary">
          {{ playbackErrorMessage ?? t('player.noSources') }}
        </p>
        <p v-if="session.sources.value.length > 0" class="text-text-muted text-sm">
          {{ t('player.tryAnotherSource') }}
        </p>
      </div>

      <!-- Info & Controls -->
      <div class="container mx-auto px-4 py-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
          <Button variant="ghost" @click="goToTitle">
            <ChevronLeft :size="20" />
            {{ titleWithEntry }}
          </Button>

          <div class="flex flex-wrap gap-2 items-center">
            <SourceSelector
              :sources="session.sources.value"
              :selected-source-id="session.selectedSourceId.value"
              :loading="session.isResolvingSource.value"
              @select="selectSource"
            />

            <!--
              A manual completion signal, available regardless of source
              surface — not only an embedded provider (which reports no
              timeupdate/ended events to this page at all), but also
              native/HLS playback, where a viewer may still want to force
              completion without watching to the exact last second.
            -->
            <Button v-if="!markedWatched" variant="glass" @click="handleMarkedWatched">
              <Check :size="20" />
              {{ t('player.markAsWatched') }}
            </Button>
            <Button v-else variant="glass" disabled class="text-primary">
              <Check :size="20" />
              {{ t('player.markedAsWatched') }}
            </Button>

            <!--
              A plain anchor, not <Button> — this navigates the viewer off
              to Byse's own download endpoint, so it needs a real `href`
              (and to open in a new tab, same as every other "leaves
              PlayAnime" link in the player). The URL itself is entirely
              server-constructed (IframePlayback.downloadUrl) — this view
              never builds a provider URL on its own.
            -->
            <a
              v-if="downloadUrl"
              :href="downloadUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium rounded-lg transition-smooth inline-flex items-center justify-center gap-2 glass-medium text-text-primary hover:glass-strong px-4 py-2 text-base"
            >
              <Download :size="20" />
              {{ t('player.download') }}
            </a>

            <Button
              v-if="siblingEpisodes.length > 0"
              variant="glass"
              @click="showEpisodeList = !showEpisodeList"
            >
              <List :size="20" />
              {{ t('anime.episodes') }}
            </Button>
          </div>
        </div>

        <div class="mb-6">
          <h1 class="text-3xl font-bold text-text-primary mb-2">
            {{ titleWithEntry }} — {{ t('anime.episode') }} {{ session.episode.value.number }}
          </h1>
          <h2 class="text-xl text-text-secondary mb-4">
            {{ session.episode.value.title }}
          </h2>

          <p v-if="session.episode.value.synopsis" class="text-text-secondary leading-relaxed mb-4">
            {{ session.episode.value.synopsis }}
          </p>
        </div>

        <EpisodeNavigation
          :has-previous-episode="session.previousEpisodeId.value !== null"
          :has-next-episode="session.nextEpisodeId.value !== null"
          @previous="playPrevious"
          @next="playNext"
          class="mb-8"
        />

        <EpisodeCredits
          v-if="session.bootstrap.value"
          :credits="session.bootstrap.value.credits"
          class="mb-8"
        />

        <EpisodeRating :episode-id="session.episode.value.id" class="mb-8" />

        <transition name="slide-down">
          <EpisodeGrid
            v-if="showEpisodeList"
            :episodes="siblingEpisodes"
            :cover-image="session.entry.value.posterUrl"
            :current-episode-id="session.episode.value.id"
            :title="`${t('anime.episodes')} (${siblingEpisodes.length})`"
            @episode-click="playEpisode"
          />
        </transition>

        <!-- Comments -->
        <CommentList :episode-id="session.episode.value.id" class="mt-8" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}
</style>
