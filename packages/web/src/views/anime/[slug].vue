<script setup lang="ts">
/**
 * Anime detail.
 *
 * Addressed by slug: the catalogue exposes stable, human-readable slugs and
 * keeps uuids for internal references, so the URL is the slug and every id that
 * appears here comes from the API rather than being derived in the browser.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AbortError, ApiError, animeApi, libraryApi } from '@/api'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useAuthStore } from '@/store/auth'
import { toAnimeDetailModel, toEpisodeCardModel, type AnimeDetailModel, type EpisodeCardModel } from '@/models'
import { Flag } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import AnimeInfo from '@/components/features/AnimeInfo.vue'
import LibraryStatusControl from '@/components/features/LibraryStatusControl.vue'
import TranslatorCredits from '@/components/features/TranslatorCredits.vue'
import EpisodeGrid from '@/components/features/EpisodeGrid.vue'
import AnimeRating from '@/components/features/Rating/AnimeRating.vue'
import CommentList from '@/components/features/Comments/CommentList.vue'
import SkeletonAnimeDetail from '@/components/ui/SkeletonAnimeDetail.vue'
import ReportTitleModal from '@/components/features/Report/ReportTitleModal.vue'

const route = useRoute('/anime/[slug]')
const router = useRouter()
const { t } = useLocale()
const authStore = useAuthStore()
const { permissions, load: loadPermissions } = useCataloguePermissions()

const anime = ref<AnimeDetailModel | null>(null)
const episodes = ref<EpisodeCardModel[]>([])
const loading = ref(true)
const notFound = ref(false)
const heroImageLoaded = ref(false)
const coverImageLoaded = ref(false)

let controller: AbortController | null = null

const pageTitle = computed(() =>
  anime.value === null ? t('common.loading') : t('pageTitle.anime', { title: anime.value.title })
)
usePageTitle(() => pageTitle.value)

const heroImage = computed(() => anime.value?.bannerUrl ?? anime.value?.posterUrl ?? null)

async function load(slug: string): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  loading.value = true
  notFound.value = false
  heroImageLoaded.value = false
  coverImageLoaded.value = false

  try {
    // Detail and episodes are independent reads; running them together halves
    // the time to a complete page.
    const [detail, episodeList] = await Promise.all([
      animeApi.bySlug(slug, request.signal),
      animeApi.episodes(slug, request.signal)
    ])

    if (request.signal.aborted) return

    anime.value = toAnimeDetailModel(detail)
    episodes.value = episodeList.map((episode) => toEpisodeCardModel(episode))

    // Progress is per-viewer and needs a separate, authenticated read; it is
    // requested after the page is renderable so it never delays the content.
    if (authStore.isAuthenticated) void loadProgress(request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return

    anime.value = null
    episodes.value = []

    // A 404 is a real answer for an unknown slug and gets the not-found view;
    // anything else is a failure worth surfacing as one.
    if (ApiError.is(cause) && cause.status === 404) {
      notFound.value = true
    } else {
      console.error('Failed to load the title:', cause)
      notFound.value = true
    }
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

/**
 * Marks episodes the viewer has already watched.
 *
 * Uses the continue-watching rail rather than one progress request per
 * episode: a 24-episode season would otherwise cost 24 round trips to render a
 * handful of progress bars.
 */
async function loadProgress(signal: AbortSignal): Promise<void> {
  try {
    const items = await libraryApi.continueWatching(signal)
    const byEpisode = new Map(items.map((item) => [item.episode.id, item]))

    episodes.value = episodes.value.map((episode) => {
      const item = byEpisode.get(episode.id)
      if (item === undefined) return episode

      const duration = item.durationSeconds ?? episode.durationSeconds
      return {
        ...episode,
        progressPercent:
          duration === null || duration <= 0
            ? null
            : Math.min(100, (item.positionSeconds / duration) * 100)
      }
    })
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load watch progress:', cause)
  }
}

onMounted(() => {
  void load(route.params.slug)
  // Decides whether the manage control renders; the server still authorizes.
  void loadPermissions()
})

// Navigating between two titles reuses this component, so the load is driven
// by the parameter rather than by mount alone.
watch(
  () => route.params.slug,
  (slug) => {
    if (typeof slug === 'string') void load(slug)
  }
)

onUnmounted(() => {
  controller?.abort()
})

const watchEpisode = (episodeId: string) => {
  void router.push({ name: '/watch/[episodeId]', params: { episodeId } })
}

const watchFirstEpisode = () => {
  const first = episodes.value[0]
  if (first !== undefined) watchEpisode(first.id)
}

const browseGenre = (slug: string) => {
  void router.push({ name: '/browse', query: { genre: slug } })
}

const browseTag = (slug: string) => {
  void router.push({ name: '/browse', query: { tag: slug } })
}

const showReportModal = ref(false)
</script>

<template>
  <SkeletonAnimeDetail v-if="loading" />

  <div v-else-if="notFound" class="container mx-auto px-4 py-24 text-center">
    <h1 class="text-3xl font-bold text-text-primary mb-4">{{ t('errors.anime.notFound') }}</h1>
    <router-link to="/browse" class="text-primary hover:text-primary-hover font-semibold">
      {{ t('nav.browse') }}
    </router-link>
  </div>

  <div v-else-if="anime" class="anime-detail">
    <!-- Hero Banner -->
    <section class="relative h-[50vh] overflow-hidden">
      <div v-if="!heroImageLoaded" class="absolute inset-0 bg-dark-800 animate-pulse" />

      <img
        v-if="heroImage"
        :src="heroImage"
        :alt="anime.title"
        :class="[
          'w-full h-full object-cover transition-opacity duration-500',
          { 'opacity-0': !heroImageLoaded, 'opacity-100': heroImageLoaded }
        ]"
        loading="lazy"
        @load="heroImageLoaded = true"
        @error="heroImageLoaded = true"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-dark-900 via-dark-900/80 to-transparent"></div>
    </section>

    <!-- Main Content -->
    <div class="container mx-auto px-4 -mt-32 relative z-10">
      <div class="flex flex-col lg:flex-row gap-8">
        <!-- Cover Image -->
        <div class="shrink-0">
          <Card variant="glass" padding="none" :hover="false" class="w-64 relative overflow-hidden">
            <div
              v-if="!coverImageLoaded"
              class="absolute inset-0 bg-dark-800 animate-pulse aspect-[2/3]"
            />

            <img
              v-if="anime.posterUrl"
              :src="anime.posterUrl"
              :alt="anime.title"
              :class="[
                'w-full aspect-[2/3] object-cover transition-opacity duration-500',
                { 'opacity-0': !coverImageLoaded, 'opacity-100': coverImageLoaded }
              ]"
              loading="lazy"
              @load="coverImageLoaded = true"
              @error="coverImageLoaded = true"
            />
            <div v-else class="w-full aspect-[2/3] bg-dark-800" />
          </Card>
        </div>

        <!-- Info Section -->
        <div class="flex-1 min-w-0">
          <div class="flex justify-end items-center gap-3 mb-3">
            <button
              type="button"
              class="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-smooth"
              @click="showReportModal = true"
            >
              <Flag :size="14" />
              {{ t('reports.reportTitle') }}
            </button>

            <!-- Rendered only for those who may edit; the server still decides. -->
            <router-link
              v-if="permissions.canCreateEpisodes"
              :to="`/catalogue/manage/${anime.slug}`"
              class="px-3 py-1.5 glass-medium rounded-lg text-sm hover:glass-strong transition-smooth"
            >
              {{ t('catalogue.manage') }}
            </router-link>
          </div>

          <AnimeInfo
            :anime="anime"
            :has-episodes="episodes.length > 0"
            @watch-now="watchFirstEpisode"
            @genre-click="browseGenre"
            @tag-click="browseTag"
          />

          <LibraryStatusControl :anime-id="anime.id" class="max-w-xs mt-3" />

          <TranslatorCredits
            :anime-id="anime.id"
            :created-by-group-id="anime.createdByGroupId"
            class="mt-4"
          />
        </div>
      </div>

      <!-- Episodes List -->
      <EpisodeGrid
        v-if="episodes.length > 0"
        :episodes="episodes"
        :cover-image="anime.posterUrl"
        class="mt-12"
        @episode-click="watchEpisode"
      />

      <p v-else class="mt-12 text-center text-text-secondary py-12">
        {{ t('anime.noEpisodes') }}
      </p>

      <!-- Rating -->
      <AnimeRating
        :anime-id="anime.id"
        :average-score="anime.rating"
        :rating-count="anime.ratingCount"
        class="mt-12"
      />

      <!-- Comments -->
      <CommentList :anime-id="anime.id" class="mt-12" />
    </div>

    <ReportTitleModal v-model="showReportModal" :anime-id="anime.id" />
  </div>
</template>
