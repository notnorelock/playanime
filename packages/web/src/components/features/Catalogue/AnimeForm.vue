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
import { AlertTriangle, Save, Search } from 'lucide-vue-next'
import {
  AGE_RATINGS,
  ENTRY_TYPES,
  RELEASE_STATUSES,
  SEASONS_OF_YEAR,
  type EntryEditBody,
  type AnimeGenre,
  type AnimeSearchResult,
  type AnimeTag,
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
import TagChipInput from '@/components/ui/TagChipInput.vue'

/**
 * Flat form-draft shape spanning both the Series (`title`, `posterUrl`,
 * `bannerUrl`) and its main Entry (everything else) — the form itself
 * stays one page for the common single-entry case; `submit()` below
 * splits it back into `SeriesCreateBody`/`EntryEditBody` for the actual
 * API calls.
 */
interface AnimeFormDraft extends Partial<EntryEditBody> {
  title?: string
}

interface Props {
  /** Absent when creating a series, or adding an entry to one. Set to edit an existing entry's own fields. */
  slug?: string | null
  /**
   * Set to add a NEW entry (a season, cour, movie, OVA...) to an EXISTING
   * series identified by this slug — a third mode alongside "create a
   * series" (`slug` and this both null) and "edit the main entry"
   * (`slug` set). Mutually exclusive with `slug`.
   */
  addEntryToSlug?: string | null
  initial?: AnimeFormDraft | null
  /** Pre-selects a group the caller belongs to, e.g. arriving from its page. */
  preferredGroupId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  slug: null,
  addEntryToSlug: null,
  initial: null,
  preferredGroupId: null
})

const emit = defineEmits<{
  saved: [slug: string]
  /** An AniList re-sync wrote straight to the database — unlike `saved`, this must not navigate the author away from the tab they're on. */
  synced: [slug: string]
  /** The edit was queued as a proposal rather than applied — nothing changed to reload. */
  proposed: []
}>()

const { t } = useLocale()
const { translateError, fieldErrors } = useApiError()
const toast = useToast()
const { groups, permissions } = useCataloguePermissions()

const isEditing = computed(() => props.slug !== null)
const isAddingEntry = computed(() => props.addEntryToSlug !== null)
/** The series' own title field is only relevant when a NEW series is being created — not when editing an entry, and not when adding an entry to a series that already has its own title. */
const needsSeriesTitle = computed(() => !isEditing.value && !isAddingEntry.value)

const form = ref({
  title: props.initial?.title ?? '',
  titleRomaji: props.initial?.titleRomaji ?? '',
  titleEnglish: props.initial?.titleEnglish ?? '',
  titleNative: props.initial?.titleNative ?? '',
  synopsis: props.initial?.synopsis ?? '',
  entryType: props.initial?.entryType ?? 'tv',
  status: props.initial?.status ?? 'not_yet_released',
  airingSeason: props.initial?.airingSeason ?? '',
  airingYear: props.initial?.airingYear === undefined ? '' : String(props.initial.airingYear),
  startDate: props.initial?.startDate ?? '',
  endDate: props.initial?.endDate ?? '',
  episodeCount:
    props.initial?.episodeCount === undefined ? '' : String(props.initial.episodeCount),
  durationMinutes:
    props.initial?.durationMinutes === undefined ? '' : String(props.initial.durationMinutes),
  ageRating: props.initial?.ageRating ?? '',
  isAdult: props.initial?.isAdult ?? false,
  vipOnly: props.initial?.vipOnly ?? false,
  posterUrl: props.initial?.posterUrl ?? '',
  bannerUrl: props.initial?.bannerUrl ?? '',
  studios: (props.initial?.studios ?? []).join(', ')
})

const selectedGenres = ref<string[]>([...(props.initial?.genres ?? [])])
const selectedTags = ref<string[]>([...(props.initial?.tags ?? [])])
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
const availableTags = ref<AnimeTag[]>([])
const duplicates = ref<DuplicateTitleWarning[]>([])
const submitting = ref(false)
const errors = ref<Record<string, string>>({})

const anilistQuery = ref('')
const anilistResults = ref<AnimeSearchResult[]>([])
const anilistSearching = ref(false)
const anilistImporting = ref(false)
/** Create mode only: which AniList entry the in-progress draft was autofilled from, submitted with the create payload so the new row is linked from the start. */
const linkedAnilistId = ref<number | null>(props.initial?.anilistId ?? null)
/** Edit mode only: whether this title is already linked, for the "Link" vs. "Re-sync" label. */
const isLinked = computed(() => props.initial?.anilistId != null)

let duplicateTimer: ReturnType<typeof setTimeout> | null = null
let controller: AbortController | null = null

let anilistSearchTimer: ReturnType<typeof setTimeout> | null = null
let anilistController: AbortController | null = null

const formatOptions = computed(() =>
  ENTRY_TYPES.map((value) => ({ label: t(`format.${value}`), value }))
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
  () =>
    form.value.titleRomaji.trim().length > 0 &&
    (!needsSeriesTitle.value || form.value.title.trim().length > 0) &&
    !submitting.value
)

onMounted(async () => {
  try {
    availableGenres.value = await animeApi.genres()
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load genres:', cause)
  }

  try {
    availableTags.value = await animeApi.tags()
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load tags:', cause)
  }
})

const genreSuggestions = computed(() => availableGenres.value.map((genre) => genre.name))
const tagSuggestions = computed(() => availableTags.value.map((tag) => tag.name))

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

// AniList search, debounced the same way as the duplicate check above —
// a separate query box, not tied to titleRomaji, so searching doesn't
// fight with what the author has already typed.
watch(anilistQuery, (query) => {
  if (anilistSearchTimer !== null) clearTimeout(anilistSearchTimer)

  const term = query.trim()
  if (term.length < 2) {
    anilistResults.value = []
    anilistSearching.value = false
    return
  }

  anilistSearchTimer = setTimeout(() => {
    void searchAnilist(term)
  }, 400)
})

async function searchAnilist(title: string): Promise<void> {
  anilistController?.abort()
  const request = new AbortController()
  anilistController = request
  anilistSearching.value = true

  try {
    const response = await catalogueApi.searchAniList(title, request.signal)
    if (!request.signal.aborted) anilistResults.value = response.results
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) anilistResults.value = []
  } finally {
    if (anilistController === request) anilistSearching.value = false
  }
}

/**
 * Autofills the in-progress draft from one picked AniList result.
 * Create mode only — nothing is persisted until the author hits Save.
 * Genres returned are ADDED to whatever the author already selected,
 * never replacing a choice made by hand — everything remains editable
 * afterward, this is a starting point, not a lock.
 */
async function autofillDraft(result: AnimeSearchResult): Promise<void> {
  const autofill = await catalogueApi.autofillFromAniList(result.anilistId)

  // Create mode only: the series' own title is unset until now, so the
  // AniList pick seeds it too — still fully editable afterward.
  if (form.value.title.trim().length === 0) form.value.title = autofill.titleRomaji
  form.value.titleRomaji = autofill.titleRomaji
  form.value.titleEnglish = autofill.titleEnglish ?? ''
  form.value.titleNative = autofill.titleNative ?? ''
  form.value.synopsis = autofill.synopsis ?? ''
  form.value.entryType = autofill.format
  form.value.status = autofill.status
  form.value.airingSeason = autofill.season ?? ''
  form.value.airingYear = autofill.seasonYear === null ? '' : String(autofill.seasonYear)
  form.value.startDate = autofill.startDate ?? ''
  form.value.endDate = autofill.endDate ?? ''
  form.value.episodeCount = autofill.episodeCount === null ? '' : String(autofill.episodeCount)
  form.value.durationMinutes =
    autofill.durationMinutes === null ? '' : String(autofill.durationMinutes)
  form.value.isAdult = autofill.isAdult
  form.value.posterUrl = autofill.posterUrl ?? ''
  form.value.bannerUrl = autofill.bannerUrl ?? ''
  form.value.studios = [
    ...new Set([
      ...form.value.studios
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
      ...autofill.studios
    ])
  ].join(', ')

  for (const name of autofill.tags) {
    if (!selectedTags.value.includes(name)) selectedTags.value.push(name)
  }

  for (const name of autofill.genres) {
    if (!selectedGenres.value.includes(name)) selectedGenres.value.push(name)
  }

  linkedAnilistId.value = result.anilistId
}

/**
 * Links and immediately syncs an EXISTING title against the picked
 * AniList result — a real write, unlike create mode's draft-only
 * autofill, since the row already exists and the point is refreshing
 * its stored data. Poster/banner are overwritten; genres/tags/studios are
 * only ever added, never removed.
 *
 * This writes straight to the database (unlike every other field on this
 * form, which stages into local state until Save is pressed) — so the
 * parent is told via `saved` to reload the title from the server
 * afterward. Skipping that left the page showing pre-sync data if the
 * author navigated away without also pressing Save.
 */
async function syncExisting(result: AnimeSearchResult): Promise<void> {
  if (props.slug === null) return

  const sync = await catalogueApi.syncAnimeFromAniList(props.slug, result.anilistId)

  form.value.posterUrl = sync.posterUrl ?? ''
  form.value.bannerUrl = sync.bannerUrl ?? ''

  for (const name of sync.addedGenres) {
    if (!selectedGenres.value.includes(name)) selectedGenres.value.push(name)
  }

  for (const name of sync.addedTags) {
    if (!selectedTags.value.includes(name)) selectedTags.value.push(name)
  }

  if (sync.addedStudios.length > 0) {
    form.value.studios = [
      ...new Set([
        ...form.value.studios
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
        ...sync.addedStudios
      ])
    ].join(', ')
  }

  const addedCount = sync.addedGenres.length + sync.addedTags.length + sync.addedStudios.length
  toast.success(
    addedCount > 0
      ? t('catalogue.anilistSyncAdded', { count: addedCount })
      : t('catalogue.anilistSyncNoChanges')
  )

  emit('synced', props.slug)
}

async function pickAnilistResult(result: AnimeSearchResult): Promise<void> {
  anilistImporting.value = true

  try {
    if (isEditing.value) await syncExisting(result)
    else await autofillDraft(result)

    anilistResults.value = []
    anilistQuery.value = ''
  } catch (cause: unknown) {
    toast.error(t('catalogue.anilistImportFailed'))
    console.error('AniList autofill/sync failed:', cause)
  } finally {
    anilistImporting.value = false
  }
}

onUnmounted(() => {
  if (duplicateTimer !== null) clearTimeout(duplicateTimer)
  controller?.abort()
  if (anilistSearchTimer !== null) clearTimeout(anilistSearchTimer)
  anilistController?.abort()
})


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

  // Shared by both create's `firstEntry` and a direct edit — everything
  // that lives on the Entry, not the Series.
  const entryFields = {
    entryType: form.value.entryType as NonNullable<EntryEditBody['entryType']>,
    titleRomaji: form.value.titleRomaji.trim(),
    titleEnglish: textOrNull(form.value.titleEnglish),
    titleNative: textOrNull(form.value.titleNative),
    synopsis: textOrNull(form.value.synopsis),
    status: form.value.status as EntryEditBody['status'],
    airingSeason: (form.value.airingSeason === '' ? null : form.value.airingSeason) as EntryEditBody['airingSeason'],
    airingYear: numberOrNull(form.value.airingYear),
    startDate: textOrNull(form.value.startDate),
    endDate: textOrNull(form.value.endDate),
    episodeCount: numberOrNull(form.value.episodeCount),
    durationMinutes: numberOrNull(form.value.durationMinutes),
    ageRating: (form.value.ageRating === '' ? null : form.value.ageRating) as EntryEditBody['ageRating'],
    isAdult: form.value.isAdult,
    vipOnly: form.value.vipOnly,
    genres: selectedGenres.value,
    studios: form.value.studios
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    tags: selectedTags.value,
    posterUrl: textOrNull(form.value.posterUrl),
    bannerUrl: textOrNull(form.value.bannerUrl),
    ...(selectedGroupId.value === '' ? {} : { groupId: selectedGroupId.value }),
    ...(isEditing.value || linkedAnilistId.value === null
      ? {}
      : { anilistId: linkedAnilistId.value })
  }

  try {
    if (isAddingEntry.value) {
      // Additive: a new season/movie/OVA on an existing series, never the
      // main one — `isMainEntry: false` matters here specifically because
      // the repository default is `true`, which would otherwise silently
      // demote whichever entry the series already treats as its main one.
      await catalogueApi.addEntry(props.addEntryToSlug ?? '', { ...entryFields, isMainEntry: false })
      toast.success(t('catalogue.saved'))
      emit('saved', props.addEntryToSlug ?? '')
      return
    }

    const result = isEditing.value
      ? await catalogueApi.updateAnime(props.slug ?? '', entryFields)
      : await catalogueApi.createAnime({
          title: form.value.title.trim() || form.value.titleRomaji.trim(),
          synopsis: textOrNull(form.value.synopsis),
          posterUrl: textOrNull(form.value.posterUrl),
          bannerUrl: textOrNull(form.value.bannerUrl),
          firstEntry: entryFields
        })

    if ('proposalId' in result) {
      // Routed to the pending-review queue instead of writing live — this
      // caller may author for some group, just not this title's owner.
      toast.success(t('catalogue.proposalSubmitted'))
      emit('proposed')
      return
    }

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
      <!--
        AniList search — three states: create (autofills the in-progress
        draft, nothing persisted until Save), edit + unlinked (picking a
        result links AND immediately syncs the saved row), edit + already
        linked (same action, framed as a re-sync).
      -->
      <div>
        <label class="block text-sm text-text-secondary mb-1">
          {{
            !isEditing
              ? t('catalogue.anilistSearchLabel')
              : isLinked
                ? t('catalogue.anilistResyncLabel')
                : t('catalogue.anilistLinkLabel')
          }}
        </label>
        <div class="relative">
          <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            v-model="anilistQuery"
            :placeholder="t('catalogue.anilistSearchPlaceholder')"
            variant="glass"
            class="pl-9"
            :disabled="anilistImporting"
          />
        </div>
        <p class="mt-1 text-xs text-text-muted">
          {{ isEditing ? t('catalogue.anilistSyncHint') : t('catalogue.anilistSearchHint') }}
        </p>

        <div
          v-if="anilistSearching || anilistResults.length > 0"
          class="mt-3 flex gap-3 overflow-x-auto pb-1"
        >
          <div v-if="anilistSearching" class="flex items-center gap-2 text-sm text-text-muted py-4">
            {{ t('common.loading') }}
          </div>
          <button
            v-for="result in anilistResults"
            :key="result.anilistId"
            type="button"
            class="shrink-0 w-24 text-left transition-smooth"
            :disabled="anilistImporting"
            @click="pickAnilistResult(result)"
          >
            <div class="relative aspect-[2/3] w-24 overflow-hidden rounded-md glass-light">
              <img
                v-if="result.posterUrl"
                :src="result.posterUrl"
                :alt="result.titleRomaji"
                class="w-full h-full object-cover"
                loading="lazy"
              />
              <div
                v-else
                class="absolute inset-0 flex items-center justify-center p-2 text-center text-text-muted text-xs"
              >
                {{ t('common.imageUnavailable') }}
              </div>
            </div>
            <p class="mt-1 text-xs text-text-secondary truncate-1" :title="result.titleRomaji">
              {{ result.titleRomaji }}
            </p>
            <p class="text-xs text-text-muted">
              {{ result.seasonYear ?? '—' }}
              <template v-if="result.format"> · {{ t(`format.${result.format}`) }}</template>
            </p>
          </button>
        </div>
      </div>

      <!-- Attribution -->
      <div v-if="groupOptions.length > 1 && !isEditing">
        <label class="block text-sm text-text-secondary mb-1">{{ t('sources.submitAs') }}</label>
        <Select v-model="selectedGroupId" :options="groupOptions" size="sm" />
      </div>

      <!--
        The series' own title — only asked for when a NEW series is made
        alongside its first entry. Editing always targets an existing
        entry, and adding an entry to an existing series reuses that
        series' own title untouched — the series itself is managed
        separately in both cases.
      -->
      <div v-if="needsSeriesTitle">
        <label class="block text-sm font-medium text-text-primary mb-2">
          {{ t('catalogue.seriesTitle') }} *
        </label>
        <Input v-model="form.title" required maxlength="255" variant="glass" />
        <p class="mt-1 text-xs text-text-muted">{{ t('catalogue.slugHint') }}</p>
      </div>

      <!-- Titles (this entry's own — a season or release can be titled differently from the series) -->
      <div>
        <label class="block text-sm font-medium text-text-primary mb-2">
          {{ t('catalogue.titleRomaji') }} *
        </label>
        <Input v-model="form.titleRomaji" required maxlength="255" variant="glass" />
        <p v-if="errors['titleRomaji']" class="mt-1 text-sm text-red-300">
          {{ errors['titleRomaji'] }}
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

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('catalogue.titleEnglish') }}</label>
          <Input v-model="form.titleEnglish" maxlength="255" variant="glass" />
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
          <Select v-model="form.entryType" :options="formatOptions" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.status') }}</label>
          <Select v-model="form.status" :options="statusOptions" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.season') }}</label>
          <Select v-model="form.airingSeason" :options="seasonOptions" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.year') }}</label>
          <Input v-model="form.airingYear" type="number" min="1900" max="2200" variant="glass" />
        </div>
      </div>

      <!-- Dates -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.startDate') }}</label>
          <Input v-model="form.startDate" type="date" variant="glass" />
        </div>
        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('anime.endDate') }}</label>
          <Input v-model="form.endDate" type="date" variant="glass" />
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
        <TagChipInput
          v-model="selectedGenres"
          :suggestions="genreSuggestions"
          :max-items="20"
          :placeholder="t('catalogue.genresHint')"
        />
        <p v-if="errors['genres']" class="mt-1 text-sm text-red-300">{{ errors['genres'] }}</p>
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('anime.studios') }}</label>
        <Input v-model="form.studios" :placeholder="t('catalogue.studiosHint')" variant="glass" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-2">{{ t('anime.tags') }}</label>
        <TagChipInput
          v-model="selectedTags"
          :suggestions="tagSuggestions"
          :max-items="30"
          :placeholder="t('catalogue.tagsHint')"
        />
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

      <label v-if="permissions.canModerate" class="flex items-center gap-2 text-sm text-text-secondary">
        <input v-model="form.vipOnly" type="checkbox" class="accent-primary" />
        {{ t('catalogue.markVip') }}
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
