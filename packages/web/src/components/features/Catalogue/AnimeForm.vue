<script setup lang="ts">
/**
 * Title authoring form.
 *
 * Used for both creating and editing. On create it checks for similar titles as
 * the author types — advisory only, because distinct works legitimately share
 * names and refusing would make those entries impossible. The author sees the
 * matches and decides.
 *
 * There is no slug field: the server derives it from the canonical title and it
 * is permanent, so letting a client choose one would invite squatting on the
 * slugs of popular titles.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle, Save } from 'lucide-vue-next'
import {
  AGE_RATINGS,
  RELEASE_STATUSES,
  SEASONS_OF_YEAR,
  TITLE_FORMATS,
  type AnimeCreateBody,
  type AnimeGenre,
  type DuplicateTitleWarning
} from '@playanime/contracts'
import { AbortError, animeApi, catalogueApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'

interface Props {
  /** Absent when creating. */
  slug?: string | null
  initial?: Partial<AnimeCreateBody> | null
  /** Pre-selects a group the caller belongs to, e.g. arriving from its page. */
  preferredGroupId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  slug: null,
  initial: null,
  preferredGroupId: null
})

const emit = defineEmits<{
  saved: [slug: string]
}>()

const { t } = useLocale()
const { translateError, fieldErrors } = useApiError()
const toast = useToast()
const { groups, permissions } = useCataloguePermissions()

const isEditing = computed(() => props.slug !== null)

const form = ref({
  titleRomaji: props.initial?.titleRomaji ?? '',
  titleEnglish: props.initial?.titleEnglish ?? '',
  titlePolish: props.initial?.titlePolish ?? '',
  titleNative: props.initial?.titleNative ?? '',
  synopsis: props.initial?.synopsis ?? '',
  format: props.initial?.format ?? 'tv',
  status: props.initial?.status ?? 'not_yet_released',
  season: props.initial?.season ?? '',
  seasonYear: props.initial?.seasonYear === undefined ? '' : String(props.initial.seasonYear),
  episodeCount:
    props.initial?.episodeCount === undefined ? '' : String(props.initial.episodeCount),
  durationMinutes:
    props.initial?.durationMinutes === undefined ? '' : String(props.initial.durationMinutes),
  ageRating: props.initial?.ageRating ?? '',
  isAdult: props.initial?.isAdult ?? false,
  posterUrl: props.initial?.posterUrl ?? '',
  bannerUrl: props.initial?.bannerUrl ?? '',
  studios: (props.initial?.studios ?? []).join(', ')
})

const selectedGenres = ref<string[]>([...(props.initial?.genres ?? [])])
/*
 * Prefers a group the caller was routed in with — from that group's own page,
 * say — falling back to their first group otherwise. The id is trusted only as
 * a starting selection: the server re-verifies membership on submit regardless
 * of what is chosen here.
 */
const selectedGroupId = ref(
  (props.preferredGroupId !== null &&
    groups.value.some((group) => group.id === props.preferredGroupId)
    ? props.preferredGroupId
    : groups.value[0]?.id) ?? ''
)
const availableGenres = ref<AnimeGenre[]>([])
const duplicates = ref<DuplicateTitleWarning[]>([])
const submitting = ref(false)
const errors = ref<Record<string, string>>({})

let duplicateTimer: ReturnType<typeof setTimeout> | null = null
let controller: AbortController | null = null

const formatOptions = computed(() =>
  TITLE_FORMATS.map((value) => ({ label: t(`format.${value}`), value }))
)
const statusOptions = computed(() =>
  RELEASE_STATUSES.map((value) => ({ label: t(`status.${value}`), value }))
)
const seasonOptions = computed(() => [
  { label: '—', value: '' },
  ...SEASONS_OF_YEAR.map((value) => ({ label: t(`season.${value}`), value }))
])
const ageOptions = computed(() => [
  { label: '—', value: '' },
  ...AGE_RATINGS.map((value) => ({ label: value.toUpperCase().replace('_', '-'), value }))
])
const groupOptions = computed(() => [
  ...(permissions.value.canModerate ? [{ label: t('sources.asStaff'), value: '' }] : []),
  ...groups.value.map((group) => ({ label: group.name, value: group.id }))
])

const canSubmit = computed(
  () => form.value.titleRomaji.trim().length > 0 && !submitting.value
)

onMounted(async () => {
  try {
    availableGenres.value = await animeApi.genres()
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load genres:', cause)
  }
})

// Duplicate detection while typing, on create only — an edit is by definition
// already the title in question.
watch(
  () => form.value.titleRomaji,
  (title) => {
    if (isEditing.value) return
    if (duplicateTimer !== null) clearTimeout(duplicateTimer)

    const term = title.trim()
    if (term.length < 3) {
      duplicates.value = []
      return
    }

    duplicateTimer = setTimeout(() => {
      void checkDuplicates(term)
    }, 400)
  }
)

async function checkDuplicates(title: string): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  try {
    const response = await catalogueApi.duplicates(title, request.signal)
    if (!request.signal.aborted) duplicates.value = response.matches
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) duplicates.value = []
  }
}

onUnmounted(() => {
  if (duplicateTimer !== null) clearTimeout(duplicateTimer)
  controller?.abort()
})

function toggleGenre(slug: string): void {
  const index = selectedGenres.value.indexOf(slug)
  if (index >= 0) selectedGenres.value.splice(index, 1)
  else selectedGenres.value.push(slug)
}

/** Empty means "not set", which the contract models as null. */
function textOrNull(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim()
}

function numberOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return

  submitting.value = true
  errors.value = {}

  const payload = {
    titleRomaji: form.value.titleRomaji.trim(),
    titleEnglish: textOrNull(form.value.titleEnglish),
    titlePolish: textOrNull(form.value.titlePolish),
    titleNative: textOrNull(form.value.titleNative),
    synopsis: textOrNull(form.value.synopsis),
    format: form.value.format as AnimeCreateBody['format'],
    status: form.value.status as AnimeCreateBody['status'],
    season: (form.value.season === '' ? null : form.value.season) as AnimeCreateBody['season'],
    seasonYear: numberOrNull(form.value.seasonYear),
    episodeCount: numberOrNull(form.value.episodeCount),
    durationMinutes: numberOrNull(form.value.durationMinutes),
    ageRating: (form.value.ageRating === ''
      ? null
      : form.value.ageRating) as AnimeCreateBody['ageRating'],
    isAdult: form.value.isAdult,
    genres: selectedGenres.value,
    studios: form.value.studios
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    posterUrl: textOrNull(form.value.posterUrl),
    bannerUrl: textOrNull(form.value.bannerUrl),
    ...(selectedGroupId.value === '' ? {} : { groupId: selectedGroupId.value })
  }

  try {
    const result = isEditing.value
      ? await catalogueApi.updateAnime(props.slug ?? '', payload)
      : await catalogueApi.createAnime(payload)

    toast.success(t('catalogue.saved'))
    emit('saved', result.slug)
  } catch (cause: unknown) {
    errors.value = fieldErrors(cause)
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Card variant="glass">
    <form class="space-y-5" @submit.prevent="submit">
      <!-- Attribution -->
      <div v-if="groupOptions.length > 1 && !isEditing">
        <label class="block text-sm text-text-secondary mb-1">{{ t('sources.submitAs') }}</label>
        <Select v-model="selectedGroupId" :options="groupOptions" size="sm" />
      </div>

      <!-- Titles -->
      <div>
        <label class="block text-sm font-medium text-text-primary mb-2">
          {{ t('catalogue.titleRomaji') }} *
        </label>
        <Input v-model="form.titleRomaji" required maxlength="255" variant="glass" />
        <p v-if="errors['titleRomaji']" class="mt-1 text-sm text-red-300">
          {{ errors['titleRomaji'] }}
        </p>
        <p v-else-if="!isEditing" class="mt-1 text-xs text-text-muted">
          {{ t('catalogue.slugHint') }}
        </p>
      </div>

      <!-- Advisory: creation is never refused on a match. -->
      <div
        v-if="duplicates.length > 0"
        class="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/40"
      >
        <p class="text-sm text-yellow-200 flex items-center gap-2 mb-2">
          <AlertTriangle :size="16" />
          {{ t('catalogue.possibleDuplicates') }}
        </p>
        <ul class="space-y-1">
          <li v-for="match in duplicates" :key="match.id" class="text-xs">
            <router-link
              :to="`/anime/${match.slug}`"
              target="_blank"
              class="text-primary hover:underline"
            >
              {{ match.title }}
            </router-link>
            <span class="text-text-muted">
              · {{ t(`format.${match.format}`) }}
              <template v-if="match.seasonYear"> · {{ match.seasonYear }}</template>
              · {{ Math.round(match.similarity * 100) }}%
            </span>
          </li>
        </ul>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('catalogue.titleEnglish') }}</label>
          <Input v-model="form.titleEnglish" maxlength="255" variant="glass" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('catalogue.titlePolish') }}</label>
          <Input v-model="form.titlePolish" maxlength="255" variant="glass" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('catalogue.titleNative') }}</label>
          <Input v-model="form.titleNative" maxlength="255" variant="glass" />
        </div>
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('anime.synopsis') }}</label>
        <Textarea v-model="form.synopsis" :rows="4" variant="glass" />
      </div>

      <!-- Classification -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.type') }}</label>
          <Select v-model="form.format" :options="formatOptions" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.status') }}</label>
          <Select v-model="form.status" :options="statusOptions" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.season') }}</label>
          <Select v-model="form.season" :options="seasonOptions" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.year') }}</label>
          <Input v-model="form.seasonYear" type="number" min="1900" max="2200" variant="glass" />
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.episodes') }}</label>
          <Input v-model="form.episodeCount" type="number" min="0" variant="glass" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.duration') }}</label>
          <Input v-model="form.durationMinutes" type="number" min="0" variant="glass" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('catalogue.ageRating') }}</label>
          <Select v-model="form.ageRating" :options="ageOptions" />
        </div>
      </div>

      <!-- Genres -->
      <div>
        <label class="block text-sm text-text-secondary mb-2">{{ t('anime.genres') }}</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="genre in availableGenres"
            :key="genre.slug"
            type="button"
            class="px-3 py-1 rounded-md text-sm transition-smooth"
            :class="
              selectedGenres.includes(genre.slug)
                ? 'bg-primary text-white'
                : 'glass-light text-text-secondary hover:glass-medium'
            "
            @click="toggleGenre(genre.slug)"
          >
            {{ genre.name }}
          </button>
        </div>
        <p v-if="errors['genres']" class="mt-1 text-sm text-red-300">{{ errors['genres'] }}</p>
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('anime.studios') }}</label>
        <Input v-model="form.studios" :placeholder="t('catalogue.studiosHint')" variant="glass" />
      </div>

      <!-- Artwork -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('catalogue.posterUrl') }}</label>
          <Input v-model="form.posterUrl" type="url" variant="glass" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('catalogue.bannerUrl') }}</label>
          <Input v-model="form.bannerUrl" type="url" variant="glass" />
        </div>
      </div>

      <label class="flex items-center gap-2 text-sm text-text-secondary">
        <input v-model="form.isAdult" type="checkbox" class="accent-primary" />
        {{ t('admin.dashboard.manage.anime.markAdult') }}
      </label>

      <div class="flex justify-end gap-2">
        <Button variant="primary" type="submit" :disabled="!canSubmit">
          <Save :size="18" />
          {{ submitting ? t('common.saving') : t('common.save') }}
        </Button>
      </div>
    </form>
  </Card>
</template>
