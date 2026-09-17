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
import { ChevronLeft, List } from 'lucide-vue-next'
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

const pageTitle = computed(() => {
  const episode = session.episode.value
  const anime = session.anime.value
  if (episode === null || anime === null) return t('common.loading')
  return t('pageTitle.episode', {
    anime: anime.title,
    number: episode.number,
    title: episode.title
  })
})
usePageTitle(() => pageTitle.value)

const playbackErrorMessage = computed(() =>
  session.playbackError.value === null ? null : translateError(session.playbackError.value)
)

/** Sibling episodes for the in-page list. Loaded once per title. */
async function loadSiblings(slug: string): Promise<void> {
  try {
    const episodes = await animeApi.episodes(slug)
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

  await session.load(episodeId)

  const slug = session.anime.value?.slug
  if (slug !== undefined && siblingEpisodes.value.length === 0) void loadSiblings(slug)
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
    // A different title means the cached episode list no longer applies.
    if (session.anime.value === null) siblingEpisodes.value = []
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
  const slug = session.anime.value?.slug
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

    <template v-else-if="session.episode.value && session.anime.value">
      <VideoPlayer
        v-if="session.descriptor.value"
        :key="`${session.episode.value.id}:${session.selectedSourceId.value ?? 'none'}`"
        :descriptor="session.descriptor.value"
        :poster="session.anime.value.posterUrl"
        :autoplay="true"
        :resume-at="session.resumePosition.value"
        :intro-start-seconds="session.episode.value.introStartSeconds"
        :intro-end-seconds="session.episode.value.introEndSeconds"
        :refresh-playback="session.refreshPlayback"
        @time-update="handleTimeUpdate"
        @paused="handlePaused"
        @seeked="handleSeeked"
        @ended="handleEnded"
        @marked-watched="handleMarkedWatched"
      />

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
            {{ session.anime.value.title }}
          </Button>

          <div class="flex flex-wrap gap-2 items-center">
            <SourceSelector
              :sources="session.sources.value"
              :selected-source-id="session.selectedSourceId.value"
              :loading="session.isResolvingSource.value"
              @select="selectSource"
            />

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
            {{ session.anime.value.title }} — {{ t('anime.episode') }} {{ session.episode.value.number }}
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

        <EpisodeRating :episode-id="session.episode.value.id" class="mb-8" />

        <transition name="slide-down">
          <EpisodeGrid
            v-if="showEpisodeList"
            :episodes="siblingEpisodes"
            :cover-image="session.anime.value.posterUrl"
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
