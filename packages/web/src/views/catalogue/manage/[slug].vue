<script setup lang="ts">
/**
 * Manage one title.
 *
 * Metadata, episodes and each episode's sources in one place, because they are
 * edited together: adding a season means adding episodes and then their
 * sources, and splitting that across three screens makes the common path
 * tedious.
 *
 * Access is decided server-side — staff may edit anything, a group only what it
 * created — so a 404 here means "not yours" as much as "not found", which is
 * deliberate: distinguishing them would tell an outsider which titles exist.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Pencil, Video } from 'lucide-vue-next'
import type { AnimeCreateBody, AnimeDetail } from '@playanime/contracts'
import { AbortError, ApiError, animeApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import AnimeForm from '@/components/features/Catalogue/AnimeForm.vue'
import EpisodeManager from '@/components/features/Catalogue/EpisodeManager.vue'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

definePage({
  meta: {
    requiresAuth: true
  }
})

const route = useRoute('/catalogue/manage/[slug]')
const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const { load: loadPermissions } = useCataloguePermissions()

type Tab = 'episodes' | 'details'

const detail = ref<AnimeDetail | null>(null)
const loading = ref(true)
const denied = ref(false)
const activeTab = ref<Tab>('episodes')

usePageTitle(() => detail.value?.titles.romaji ?? t('common.loading'))

/** Seeds the edit form from the loaded title. */
const initial = computed<Partial<AnimeCreateBody> | null>(() => {
  const anime = detail.value
  if (anime === null) return null

  return {
    titleRomaji: anime.titles.romaji,
    titleEnglish: anime.titles.english,
    titleNative: anime.titles.native,
    synopsis: anime.synopsis,
    format: anime.format,
    status: anime.status,
    season: anime.season,
    seasonYear: anime.seasonYear,
    episodeCount: anime.episodeCount,
    durationMinutes: anime.durationMinutes,
    ageRating: anime.ageRating,
    isAdult: anime.isAdult,
    genres: anime.genres.map((genre) => genre.slug),
    studios: anime.studios.map((studio) => studio.name),
    posterUrl: anime.poster?.url ?? null,
    bannerUrl: anime.banner?.url ?? null,
    anilistId: anime.anilistId ?? undefined
  }
})

async function load(slug: string): Promise<void> {
  loading.value = true
  denied.value = false

  try {
    detail.value = await animeApi.bySlug(slug)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return

    detail.value = null
    // 404 covers both "no such title" and "not yours", by design.
    denied.value = ApiError.is(cause) && cause.status === 404
    if (!denied.value) toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  // Force, not the session-lifetime cache — same reasoning as
  // catalogue/create.vue: this page decides what editing controls to
  // show, so a group verified or joined since the cache was last
  // populated must not still read as "cannot author."
  await loadPermissions(true)
  await load(route.params.slug)
})

watch(
  () => route.params.slug,
  (slug) => {
    if (typeof slug === 'string') void load(slug)
  }
)

function onSaved(slug: string): void {
  void load(slug)
  activeTab.value = 'episodes'
}
</script>

<template>
  <div class="catalogue-manage container mx-auto px-4 py-8 max-w-5xl">
    <Card v-if="loading" variant="glass" class="p-8 animate-pulse">
      <div class="h-6 bg-white/10 rounded w-1/3 mb-3"></div>
      <div class="h-4 bg-white/10 rounded w-1/4"></div>
    </Card>

    <Card v-else-if="denied || detail === null" variant="glass" class="p-12 text-center space-y-4">
      <p class="text-text-primary text-lg">{{ t('errors.anime.notFound') }}</p>
      <Button variant="glass" @click="router.push('/browse')">
        {{ t('nav.browse') }}
      </Button>
    </Card>

    <template v-else>
      <!-- Header -->
      <div class="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div class="flex items-center gap-4 min-w-0">
          <img
            v-if="detail.poster"
            :src="detail.poster.url"
            :alt="detail.titles.romaji"
            class="w-16 h-24 rounded-lg object-cover shrink-0"
          />
          <div class="min-w-0">
            <h1 class="text-2xl font-bold text-text-primary truncate">
              {{ detail.titles.romaji }}
            </h1>
            <p class="text-text-muted text-sm">{{ detail.slug }}</p>
          </div>
        </div>

        <Button variant="ghost" @click="router.push(`/anime/${detail.slug}`)">
          <ArrowLeft :size="18" />
          {{ t('common.view') }}
        </Button>
      </div>

      <!-- Tabs -->
      <div class="glass-medium rounded-lg p-1 inline-flex gap-1 mb-6">
        <button
          type="button"
          class="px-4 py-2 rounded-md text-sm font-medium transition-smooth flex items-center gap-2"
          :class="
            activeTab === 'episodes'
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
          "
          @click="activeTab = 'episodes'"
        >
          <Video :size="16" />
          {{ t('anime.episodes') }}
        </button>
        <button
          type="button"
          class="px-4 py-2 rounded-md text-sm font-medium transition-smooth flex items-center gap-2"
          :class="
            activeTab === 'details'
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
          "
          @click="activeTab = 'details'"
        >
          <Pencil :size="16" />
          {{ t('catalogue.details') }}
        </button>
      </div>

      <EpisodeManager v-if="activeTab === 'episodes'" :slug="detail.slug" />

      <AnimeForm v-else :slug="detail.slug" :initial="initial" @saved="onSaved" />
    </template>
  </div>
</template>
