<script setup lang="ts">
/**
 * Anime (series) detail.
 *
 * Addressed by slug: the catalogue exposes stable, human-readable slugs and
 * keeps uuids for internal references, so the URL is the slug and every id
 * that appears here comes from the API rather than being derived in the
 * browser.
 *
 * A series can have several entries — seasons, cours, a movie, an OVA. The
 * season selector below lets the viewer switch between them; the info panel,
 * episode list and "watch now" action all follow the selected entry, while
 * rating/library/comments stay series-scoped (a viewer rates and lists
 * "Attack on Titan," not "Attack on Titan Season 2" specifically).
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AbortError, ApiError, animeApi, libraryApi } from '@/api'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useAuthStore } from '@/store/auth'
import {
  pickDefaultEntry,
  toEntryDetailModel,
  toEpisodeCardModel,
  toSeriesDetailModel,
  type EntryDetailModel,
  type EpisodeCardModel,
  type SeriesDetailModel
} from '@/models'
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

const series = ref<SeriesDetailModel | null>(null)
const selectedEntryId = ref<string | null>(null)
const entryDetail = ref<EntryDetailModel | null>(null)
const episodes = ref<EpisodeCardModel[]>([])
const loading = ref(true)
const loadingEntry = ref(false)
const notFound = ref(false)
const heroImageLoaded = ref(false)
const coverImageLoaded = ref(false)

let controller: AbortController | null = null
let entryController: AbortController | null = null

const pageTitle = computed(() =>
  series.value === null ? t('common.loading') : t('pageTitle.anime', { title: series.value.title })
)
usePageTitle(() => pageTitle.value)

const heroImage = computed(
  () => entryDetail.value?.bannerUrl ?? series.value?.bannerUrl ?? series.value?.posterUrl ?? null
)
const coverImage = computed(() => entryDetail.value?.posterUrl ?? series.value?.posterUrl ?? null)

/** Seasons/cours grouped separately from extras (movies, OVAs, specials...) for the selector. */
const mainEntries = computed(() => (series.value?.entries ?? []).filter((entry) => entry.isMainEntry))
const extraEntries = computed(() => (series.value?.entries ?? []).filter((entry) => !entry.isMainEntry))

async function load(slug: string): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  loading.value = true
  notFound.value = false
  heroImageLoaded.value = false
  coverImageLoaded.value = false

  try {
    const detail = await animeApi.bySlug(slug, request.signal)
    if (request.signal.aborted) return

    series.value = toSeriesDetailModel(detail)

    const defaultEntry = pickDefaultEntry(detail.entries)
    if (defaultEntry !== null) await selectEntry(defaultEntry.id, request.signal)

    // Progress is per-viewer and needs a separate, authenticated read; it is
    // requested after the page is renderable so it never delays the content.
    if (authStore.isAuthenticated) void loadProgress(request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return

    series.value = null
    entryDetail.value = null
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

/** Switches the season/entry selector — loads that entry's own detail and episode list. */
async function selectEntry(entryId: string, signal?: AbortSignal): Promise<void> {
  const current = series.value
  if (current === null) return

  const summary = current.entries.find((entry) => entry.id === entryId)
  if (summary === undefined) return

  entryController?.abort()
  const request = new AbortController()
  entryController = request
  const effectiveSignal = signal ?? request.signal

  selectedEntryId.value = entryId
  loadingEntry.value = true

  try {
    const isMain = summary.isMainEntry
    const [detail, episodeList] = await Promise.all([
      animeApi.entryDetail(current.slug, entryId, effectiveSignal),
      isMain
        ? animeApi.episodes(current.slug, effectiveSignal)
        : animeApi.entryEpisodes(current.slug, entryId, effectiveSignal)
    ])
    if (effectiveSignal.aborted) return

    entryDetail.value = toEntryDetailModel(detail)
    episodes.value = episodeList.map((episode) => toEpisodeCardModel(episode))
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load the entry:', cause)
  } finally {
    if (entryController === request) loadingEntry.value = false
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
  entryController?.abort()
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

  <div v-else-if="series" class="anime-detail">
    <!-- Hero Banner -->
    <section class="relative h-[50vh] overflow-hidden">
      <div v-if="!heroImageLoaded" class="absolute inset-0 bg-dark-800 animate-pulse" />

      <img
        v-if="heroImage"
        :src="heroImage"
        :alt="series.title"
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
              v-if="coverImage"
              :src="coverImage"
              :alt="series.title"
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
              :to="`/catalogue/manage/${series.slug}`"
              class="px-3 py-1.5 glass-medium rounded-lg text-sm hover:glass-strong transition-smooth"
            >
              {{ t('catalogue.manage') }}
            </router-link>
          </div>

          <!--
            Season/entry selector — only shown once there is a real choice
            to make. A single-entry series (the common case) renders no
            selector at all, matching how it always worked before this
            feature existed.
          -->
          <div v-if="series.entries.length > 1" class="flex flex-wrap gap-2 mb-4">
            <button
              v-for="entry in mainEntries"
              :key="entry.id"
              type="button"
              :class="[
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth',
                entry.id === selectedEntryId
                  ? 'bg-primary text-white'
                  : 'glass-light text-text-secondary hover:glass-medium'
              ]"
              @click="selectEntry(entry.id)"
            >
              {{ entry.seasonNumber !== null ? t('anime.seasonNumber', { number: entry.seasonNumber }) : entry.titles.romaji }}
              <span v-if="entry.courNumber !== null" class="opacity-75"> · {{ t('anime.courNumber', { number: entry.courNumber }) }}</span>
            </button>

            <span v-if="extraEntries.length > 0 && mainEntries.length > 0" class="w-px bg-white/10 mx-1" />

            <button
              v-for="entry in extraEntries"
              :key="entry.id"
              type="button"
              :class="[
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth',
                entry.id === selectedEntryId
                  ? 'bg-primary text-white'
                  : 'glass-light text-text-secondary hover:glass-medium'
              ]"
              @click="selectEntry(entry.id)"
            >
              {{ t(`format.${entry.entryType}`) }}
              <template v-if="entry.titles.romaji !== series.title"> — {{ entry.titles.romaji }}</template>
            </button>
          </div>

          <AnimeInfo
            :series="series"
            :entry="entryDetail"
            :has-episodes="episodes.length > 0"
            @watch-now="watchFirstEpisode"
            @genre-click="browseGenre"
            @tag-click="browseTag"
          />

          <LibraryStatusControl :anime-id="series.id" class="max-w-xs mt-3" />

          <TranslatorCredits
            v-if="entryDetail"
            :anime-id="entryDetail.id"
            :created-by-group-id="entryDetail.createdByGroupId"
            class="mt-4"
          />
        </div>
      </div>

      <!-- Episodes List -->
      <div v-if="loadingEntry" class="mt-12 text-center text-text-secondary py-12">
        {{ t('common.loading') }}
      </div>
      <EpisodeGrid
        v-else-if="episodes.length > 0"
        :episodes="episodes"
        :cover-image="coverImage"
        class="mt-12"
        @episode-click="watchEpisode"
      />

      <p v-else class="mt-12 text-center text-text-secondary py-12">
        {{ t('anime.noEpisodes') }}
      </p>

      <!-- Rating -->
      <AnimeRating
        :anime-id="series.id"
        :average-score="series.rating"
        :rating-count="series.ratingCount"
        class="mt-12"
      />

      <!-- Comments -->
      <CommentList :anime-id="series.id" class="mt-12" />
    </div>

    <ReportTitleModal v-model="showReportModal" :anime-id="series.id" />
  </div>
</template>
