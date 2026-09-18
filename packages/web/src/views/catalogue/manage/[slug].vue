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
import { ArrowLeft, History, Layers, Pencil, Plus, Video } from 'lucide-vue-next'
import type { EntryDetailDto, EntrySummaryDto, SeriesDetailDto } from '@playanime/contracts'
import { pickDefaultEntry } from '@/models'
import { AbortError, ApiError, adminApi, animeApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import { isAdmin } from '@/utils/user'
import AnimeForm from '@/components/features/Catalogue/AnimeForm.vue'
import EpisodeManager from '@/components/features/Catalogue/EpisodeManager.vue'
import AuditTrailList from '@/components/features/Catalogue/AuditTrailList.vue'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'

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
const authStore = useAuthStore()

/** Only an administrator sees the permanent-delete control — same tier the backend route requires. */
const canDelete = computed(() => isAdmin(authStore.user))

type Tab = 'episodes' | 'seasons' | 'details' | 'history'

const series = ref<SeriesDetailDto | null>(null)
/** The series' main entry — editing (`AnimeForm`) and episode management both target this one, matching the API's own `updateAnime`/episode routes, which are still slug-scoped to the main entry. */
const mainEntry = ref<EntryDetailDto | null>(null)
const loading = ref(true)
const denied = ref(false)
const activeTab = ref<Tab>('episodes')
/** Toggles the "add a new season/movie/OVA" form on the Seasons tab. */
const showAddEntry = ref(false)

/** Every entry under this series, in release order — the Seasons tab's own list. */
const entries = computed<readonly EntrySummaryDto[]>(() => series.value?.entries ?? [])

usePageTitle(() => mainEntry.value?.titles.romaji ?? series.value?.title ?? t('common.loading'))

/** Seeds the edit form from the loaded title. */
const initial = computed(() => {
  const seriesDetail = series.value
  const entry = mainEntry.value
  if (seriesDetail === null || entry === null) return null

  return {
    title: seriesDetail.title,
    titleRomaji: entry.titles.romaji,
    titleEnglish: entry.titles.english,
    titleNative: entry.titles.native,
    synopsis: entry.synopsis,
    entryType: entry.entryType,
    status: entry.status,
    airingSeason: entry.airingSeason,
    airingYear: entry.airingYear,
    startDate: entry.startDate,
    endDate: entry.endDate,
    episodeCount: entry.episodeCount,
    durationMinutes: entry.durationMinutes,
    ageRating: entry.ageRating,
    isAdult: entry.isAdult,
    genres: entry.genres.map((genre) => genre.name),
    studios: entry.studios.map((studio) => studio.name),
    tags: entry.tags.map((tag) => tag.name),
    posterUrl: entry.poster?.url ?? null,
    bannerUrl: entry.banner?.url ?? null,
    anilistId: entry.anilistId ?? undefined
  }
})

async function load(slug: string): Promise<void> {
  loading.value = true
  denied.value = false

  try {
    const detail = await animeApi.bySlug(slug)
    series.value = detail

    const defaultEntry = pickDefaultEntry(detail.entries)
    mainEntry.value = defaultEntry === null ? null : await animeApi.entryDetail(slug, defaultEntry.id)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return

    series.value = null
    mainEntry.value = null
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

/** AniList re-sync wrote straight to the database — reload, but stay on the details tab. */
function onSynced(slug: string): void {
  void load(slug)
}

/** A new entry was added — reload the series (its entries[] now includes it) and close the inline form. */
function onEntryAdded(): void {
  showAddEntry.value = false
  void load(series.value?.slug ?? '')
}

/** The edit was queued as a proposal, not applied — nothing to reload. */
function onProposed(): void {
  // AnimeForm already shows its own success toast for this case.
}

/* -------------------------------------------------------------------------- */
/* Permanent delete (admin only)                                              */
/* -------------------------------------------------------------------------- */

const showDeletePanel = ref(false)
const deleteReason = ref('')
const deleteConfirmation = ref('')
const deleting = ref(false)

function openDeletePanel(): void {
  showDeletePanel.value = true
  deleteReason.value = ''
  deleteConfirmation.value = ''
}

function closeDeletePanel(): void {
  showDeletePanel.value = false
  deleteReason.value = ''
  deleteConfirmation.value = ''
}

async function confirmDelete(): Promise<void> {
  const current = series.value
  if (current === null) return
  if (deleteReason.value.trim().length === 0 || deleteConfirmation.value !== current.title) return

  deleting.value = true
  try {
    await adminApi.deleteAnime(current.id, deleteReason.value.trim())
    toast.success(t('admin.dashboard.manage.anime.deleted'))
    await router.push('/browse')
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="catalogue-manage container mx-auto px-4 py-8 max-w-5xl">
    <Card v-if="loading" variant="glass" class="p-8 animate-pulse">
      <div class="h-6 bg-white/10 rounded w-1/3 mb-3"></div>
      <div class="h-4 bg-white/10 rounded w-1/4"></div>
    </Card>

    <Card v-else-if="denied || series === null || mainEntry === null" variant="glass" class="p-12 text-center space-y-4">
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
            v-if="mainEntry.poster"
            :src="mainEntry.poster.url"
            :alt="mainEntry.titles.romaji"
            class="w-16 h-24 rounded-lg object-cover shrink-0"
          />
          <div class="min-w-0">
            <h1 class="text-2xl font-bold text-text-primary truncate">
              {{ series.title }}
            </h1>
            <p class="text-text-muted text-sm">{{ series.slug }}</p>
          </div>
        </div>

        <Button variant="ghost" @click="router.push(`/anime/${series.slug}`)">
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
            activeTab === 'seasons'
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
          "
          @click="activeTab = 'seasons'"
        >
          <Layers :size="16" />
          {{ t('catalogue.seasons') }}
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
        <button
          type="button"
          class="px-4 py-2 rounded-md text-sm font-medium transition-smooth flex items-center gap-2"
          :class="
            activeTab === 'history'
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-white/10'
          "
          @click="activeTab = 'history'"
        >
          <History :size="16" />
          {{ t('catalogue.history') }}
        </button>
      </div>

      <EpisodeManager v-if="activeTab === 'episodes'" :slug="series.slug" />

      <AuditTrailList v-else-if="activeTab === 'history'" :slug="series.slug" />

      <div v-else-if="activeTab === 'seasons'" class="space-y-4">
        <Card
          v-for="entry in entries"
          :key="entry.id"
          variant="glass"
          class="p-4 flex items-center justify-between gap-4"
        >
          <div class="flex items-center gap-3 min-w-0">
            <img
              v-if="entry.poster"
              :src="entry.poster.url"
              :alt="entry.titles.romaji"
              class="w-10 h-14 rounded object-cover shrink-0"
            />
            <div class="min-w-0">
              <p class="font-medium text-text-primary truncate">
                {{ entry.titles.romaji }}
                <span v-if="entry.id === mainEntry?.id" class="text-xs text-primary font-normal">
                  ({{ t('catalogue.mainEntry') }})
                </span>
              </p>
              <p class="text-xs text-text-muted">
                {{ t(`format.${entry.entryType}`) }}
                <template v-if="entry.seasonNumber !== null"> · {{ t('anime.seasonNumber', { number: entry.seasonNumber }) }}</template>
                <template v-if="entry.courNumber !== null"> · {{ t('anime.courNumber', { number: entry.courNumber }) }}</template>
                <template v-if="entry.airingYear"> · {{ entry.airingYear }}</template>
              </p>
            </div>
          </div>
        </Card>

        <p v-if="entries.length === 0" class="text-center text-text-secondary py-8">
          {{ t('catalogue.noEntries') }}
        </p>

        <Button v-if="!showAddEntry" variant="glass" @click="showAddEntry = true">
          <Plus :size="18" />
          {{ t('catalogue.addEntry') }}
        </Button>

        <template v-else>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold text-text-primary">{{ t('catalogue.addEntry') }}</h3>
            <Button variant="ghost" size="sm" @click="showAddEntry = false">{{ t('common.cancel') }}</Button>
          </div>
          <AnimeForm :add-entry-to-slug="series.slug" @saved="onEntryAdded" />
        </template>
      </div>

      <div v-else-if="activeTab === 'details'" class="space-y-6">
        <AnimeForm
          :slug="series.slug"
          :initial="initial"
          @saved="onSaved"
          @synced="onSynced"
          @proposed="onProposed"
        />

        <Card v-if="canDelete" variant="glass" class="p-5 border border-red-500/30 space-y-4">
          <div>
            <h3 class="text-lg font-semibold text-red-400">{{ t('admin.dashboard.manage.anime.delete') }}</h3>
            <p class="text-sm text-text-secondary mt-1">{{ t('admin.dashboard.manage.anime.deleteWarning') }}</p>
          </div>

          <Button v-if="!showDeletePanel" variant="ghost" class="text-red-400 hover:text-red-300" @click="openDeletePanel">
            {{ t('admin.dashboard.manage.anime.delete') }}
          </Button>

          <template v-else>
            <div>
              <label class="block text-sm text-text-secondary mb-1">{{ t('admin.dashboard.reason') }}</label>
              <Textarea v-model="deleteReason" :rows="3" />
            </div>

            <div>
              <label class="block text-sm text-text-secondary mb-1">
                {{ t('admin.dashboard.manage.anime.deleteConfirmLabel', { title: series.title }) }}
              </label>
              <Input v-model="deleteConfirmation" />
            </div>

            <div class="flex justify-end gap-2">
              <Button variant="ghost" @click="closeDeletePanel">{{ t('common.cancel') }}</Button>
              <Button
                variant="primary"
                class="bg-red-600! hover:bg-red-500!"
                :disabled="deleting || deleteReason.trim().length === 0 || deleteConfirmation !== series.title"
                @click="confirmDelete"
              >
                {{ deleting ? t('common.saving') : t('admin.dashboard.manage.anime.delete') }}
              </Button>
            </div>
          </template>
        </Card>
      </div>
    </template>
  </div>
</template>
