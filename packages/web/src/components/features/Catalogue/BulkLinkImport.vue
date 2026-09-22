<script setup lang="ts">
/**
 * Bulk episode + source import.
 *
 * Paste one URL per line, in episode order — line 1 becomes episode 1's
 * source, line 2 becomes episode 2's, and so on from a configurable start
 * number. This is the in-app equivalent of what the personal migration
 * tool (`.local/animewatch-migration/`) does against a WordPress export:
 * ensure the episode exists, then submit exactly one source for it — just
 * driven from a pasted list instead of a WXR file, for adding a season a
 * translator group already has links for without clicking through
 * "add episode -> add source" one at a time.
 *
 * Sequential, not parallel: episode creation and source submission are
 * both real writes with their own ordering concerns (a duplicate-episode-
 * number race, a rate limit), and there is no benefit to parallelizing a
 * paste of a few dozen lines at most.
 *
 * Kind/audio/subtitle language are applied uniformly to every line, not
 * asked per line — the whole point of a bulk paste is that these values
 * are almost always the same for an entire season's worth of links from
 * one source. A line that needs different metadata is still addable
 * individually afterward via the normal per-episode source form.
 */

import { computed, ref } from 'vue'
import { Import, Loader2 } from 'lucide-vue-next'
import {
  QUALITY_HINTS,
  SOURCE_KINDS,
  SOURCE_LANGUAGES,
  type QualityHint,
  type SourceKind,
  type SourceLanguage
} from '@playanime/contracts'
import { catalogueApi, ApiError } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Modal from '@/components/ui/Modal/Modal.vue'

interface Props {
  slug: string
  /** Highest existing episode number, so the default start is "the next one" rather than always 1. */
  nextEpisodeNumber: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  imported: []
}>()

const { t } = useLocale()
const { translateError } = useApiError()
const { permissions, groups } = useCataloguePermissions()
const toast = useToast()

const isOpen = ref(false)
const linksText = ref('')
const startNumber = ref(String(props.nextEpisodeNumber))
const kind = ref<SourceKind>('dub')
const audioLanguage = ref<SourceLanguage | ''>('pl')
const subtitleLanguage = ref<SourceLanguage | ''>('pl')
const qualityHint = ref<QualityHint | ''>('')
const rightsAttested = ref(false)
const selectedGroupId = ref(groups.value[0]?.id ?? '')

const kindOptions = computed(() => SOURCE_KINDS.map((value) => ({ label: t(`sources.kind.${value}`), value })))
const languageOptions = computed(() => [
  { label: '—', value: '' },
  ...SOURCE_LANGUAGES.map((value) => ({ label: value.toUpperCase(), value }))
])
const qualityOptions = computed(() => [
  { label: '—', value: '' },
  ...QUALITY_HINTS.filter((value) => value !== 'unknown').map((value) => ({ label: value, value }))
])
const groupOptions = computed(() => [
  ...(permissions.value.canModerate ? [{ label: t('sources.asStaff'), value: '' }] : []),
  ...groups.value.map((group) => ({ label: group.isVerified ? `${group.name} ✓` : group.name, value: group.id }))
])

/** One non-empty, trimmed line per entry — blank lines are just spacing in the paste and are silently skipped, not treated as a gap in numbering. */
const links = computed(() =>
  linksText.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
)

/** [number, url][] — the actual number a line will land on once opened. */
const plan = computed(() => {
  const start = Number.parseInt(startNumber.value, 10)
  if (!Number.isFinite(start)) return []
  return links.value.map((url, index) => [start + index, url] as const)
})

const canImport = computed(
  () => rightsAttested.value && plan.value.length > 0 && !importing.value
)

/** Group to attribute a write to, omitted when acting as staff. */
function groupPayload(): { groupId?: string } {
  return selectedGroupId.value === '' ? {} : { groupId: selectedGroupId.value }
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

interface LineResult {
  number: number
  url: string
  status: 'pending' | 'ok' | 'failed'
  error?: string
}

const importing = ref(false)
const results = ref<LineResult[]>([])

async function runImport(): Promise<void> {
  if (!canImport.value) return

  importing.value = true
  results.value = plan.value.map(([number, url]) => ({ number, url, status: 'pending' }))

  try {
    // Resolved once up front and reused for every line below — a fresh
    // GET per line would both be wasteful and race itself as this same
    // import creates episodes partway through the list.
    const existing = await catalogueApi.episodes(props.slug)
    const idByNumber = new Map(existing.map((episode) => [episode.number, episode.id]))

    for (let index = 0; index < results.value.length; index += 1) {
      const line = results.value[index]
      if (line === undefined) continue

      try {
        let episodeId = idByNumber.get(line.number)
        if (episodeId === undefined) {
          const created = await catalogueApi.createEpisode(props.slug, {
            number: line.number,
            ...groupPayload()
          })
          episodeId = created.id
          idByNumber.set(line.number, created.id)
        }

        const response = await catalogueApi.submitSources(episodeId, {
          rightsAttested: true,
          ...groupPayload(),
          sources: [
            {
              url: line.url,
              kind: kind.value,
              ...(audioLanguage.value === '' ? {} : { audioLanguage: audioLanguage.value }),
              ...(subtitleLanguage.value === '' ? {} : { subtitleLanguage: subtitleLanguage.value }),
              ...(qualityHint.value === '' ? {} : { qualityHint: qualityHint.value })
            }
          ]
        })

        const outcome = response.results[0]
        if (outcome?.accepted === true) {
          line.status = 'ok'
        } else {
          line.status = 'failed'
          line.error = outcome?.error ?? t('sources.genericRejected')
        }
      } catch (cause: unknown) {
        line.status = 'failed'
        line.error = ApiError.is(cause) ? cause.message : translateError(cause)
      }
    }

    const okCount = results.value.filter((line) => line.status === 'ok').length
    const failedCount = results.value.length - okCount

    if (failedCount === 0) {
      toast.success(t('catalogue.bulkImportSuccess', { count: okCount }))
    } else {
      toast.error(t('catalogue.bulkImportPartial', { ok: okCount, failed: failedCount }))
    }

    emit('imported')
  } finally {
    importing.value = false
  }
}

function close(): void {
  if (importing.value) return
  isOpen.value = false
  linksText.value = ''
  results.value = []
  rightsAttested.value = false
  startNumber.value = String(props.nextEpisodeNumber)
}
</script>

<template>
  <Button variant="glass" size="sm" @click="isOpen = true">
    <Import :size="16" />
    {{ t('catalogue.bulkImport') }}
  </Button>

  <Modal :model-value="isOpen" size="lg" @update:model-value="close">
    <div class="space-y-4 p-2 max-h-[75vh] overflow-y-auto">
      <div>
        <h3 class="text-xl font-semibold text-text-primary">{{ t('catalogue.bulkImport') }}</h3>
        <p class="text-sm text-text-secondary mt-1">{{ t('catalogue.bulkImportHint') }}</p>
      </div>

      <div v-if="groupOptions.length > 0">
        <label class="block text-sm text-text-secondary mb-1">{{ t('sources.submitAs') }}</label>
        <Select v-model="selectedGroupId" :options="groupOptions" size="sm" />
      </div>

      <div>
        <label class="block text-sm text-text-secondary mb-1">{{ t('catalogue.bulkImportLinks') }}</label>
        <Textarea
          v-model="linksText"
          :rows="10"
          :placeholder="t('catalogue.bulkImportLinksPlaceholder')"
          variant="glass"
          class="font-mono text-sm"
        />
        <p class="text-xs text-text-muted mt-1">
          {{ t('catalogue.bulkImportLineCount', { count: links.length }) }}
        </p>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.bulkImportStartNumber') }}</label>
          <Input v-model="startNumber" type="number" min="0" variant="glass" size="sm" />
        </div>
        <div>
          <label class="block text-xs text-text-muted mb-1">{{ t('sources.kindLabel') }}</label>
          <Select v-model="kind" :options="kindOptions" size="sm" />
        </div>
        <div>
          <label class="block text-xs text-text-muted mb-1">{{ t('sources.audio') }}</label>
          <Select v-model="audioLanguage" :options="languageOptions" size="sm" />
        </div>
        <div>
          <label class="block text-xs text-text-muted mb-1">{{ t('sources.subtitles') }}</label>
          <Select v-model="subtitleLanguage" :options="languageOptions" size="sm" />
        </div>
      </div>

      <div class="max-w-[12rem]">
        <label class="block text-xs text-text-muted mb-1">{{ t('player.quality') }}</label>
        <Select v-model="qualityHint" :options="qualityOptions" size="sm" />
      </div>

      <!-- Preview of what will be created, before anything is submitted. -->
      <div v-if="plan.length > 0 && results.length === 0" class="glass-light rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
        <div v-for="[number, url] in plan" :key="number" class="flex items-center gap-2 text-xs">
          <span class="font-semibold text-primary shrink-0 w-10">#{{ number }}</span>
          <span class="text-text-secondary truncate">{{ url }}</span>
        </div>
      </div>

      <!-- Live per-line results while/after importing. -->
      <div v-if="results.length > 0" class="glass-light rounded-lg p-3 max-h-56 overflow-y-auto space-y-1">
        <div
          v-for="line in results"
          :key="line.number"
          class="flex items-start gap-2 text-xs"
          :class="{
            'text-text-muted': line.status === 'pending',
            'text-green-300': line.status === 'ok',
            'text-red-300': line.status === 'failed'
          }"
        >
          <span class="font-semibold shrink-0 w-10">#{{ line.number }}</span>
          <Loader2 v-if="line.status === 'pending'" :size="14" class="animate-spin shrink-0 mt-0.5" />
          <span v-else class="shrink-0">{{ line.status === 'ok' ? '✓' : '✕' }}</span>
          <span class="truncate flex-1">{{ line.url }}</span>
          <span v-if="line.error" class="text-text-muted">— {{ line.error }}</span>
        </div>
      </div>

      <!-- Same attestation text/wording as the single-episode form — this is a legal record either way. -->
      <label class="flex items-start gap-2 text-sm text-text-secondary">
        <input v-model="rightsAttested" type="checkbox" class="accent-primary mt-1" :disabled="importing" />
        <span>{{ t('sources.rightsAttestation') }}</span>
      </label>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="ghost" :disabled="importing" @click="close">{{ t('common.cancel') }}</Button>
        <Button variant="primary" :disabled="!canImport" @click="runImport">
          <Import :size="16" />
          {{ importing ? t('common.saving') : t('catalogue.bulkImportSubmit', { count: links.length }) }}
        </Button>
      </div>
    </div>
  </Modal>
</template>
