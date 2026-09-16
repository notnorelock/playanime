<script setup lang="ts">
/**
 * Source submission.
 *
 * Several URLs at once, because the same release is routinely mirrored across
 * providers and adding them one at a time would mean re-affirming the rights
 * attestation per mirror.
 *
 * The form never parses a URL or names a provider itself — it posts what the
 * user typed and renders what the server detected. Provider handling lives in
 * `@playanime/external-media`, and duplicating any of it here would be exactly
 * the leak the architecture exists to prevent.
 */

import { computed, ref } from 'vue'
import { Plus, Trash2, Upload } from 'lucide-vue-next'
import {
  QUALITY_HINTS,
  SOURCE_KINDS,
  SOURCE_LANGUAGES,
  type SourceBatchResultItem,
  type SourceKind,
  type SourceLanguage,
  type QualityHint
} from '@playanime/contracts'
import { catalogueApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'

interface Props {
  episodeId: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  submitted: []
}>()

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const { permissions, groups } = useCataloguePermissions()

interface DraftSource {
  url: string
  kind: SourceKind
  subtitleLanguage: string
  audioLanguage: string
  qualityHint: string
}

function emptyDraft(): DraftSource {
  return { url: '', kind: 'sub', subtitleLanguage: 'pl', audioLanguage: '', qualityHint: '' }
}

const drafts = ref<DraftSource[]>([emptyDraft()])
const rightsAttested = ref(false)
const selectedGroupId = ref<string>(groups.value[0]?.id ?? '')
const submitting = ref(false)
const results = ref<SourceBatchResultItem[]>([])

const MAX_SOURCES = 10

const kindOptions = computed(() =>
  SOURCE_KINDS.map((value) => ({ label: t(`sources.kind.${value}`), value }))
)

const languageOptions = computed(() => [
  { label: '—', value: '' },
  ...SOURCE_LANGUAGES.map((value) => ({ label: value.toUpperCase(), value }))
])

const qualityOptions = computed(() => [
  { label: '—', value: '' },
  ...QUALITY_HINTS.filter((value) => value !== 'unknown').map((value) => ({
    label: value,
    value
  }))
])

const groupOptions = computed(() => [
  ...(permissions.value.canModerate ? [{ label: t('sources.asStaff'), value: '' }] : []),
  ...groups.value.map((group) => ({
    label: group.isVerified ? `${group.name} ✓` : group.name,
    value: group.id
  }))
])

/** Whether what is submitted now will be visible to viewers immediately. */
const publishesImmediately = computed(() => {
  if (permissions.value.canModerate && selectedGroupId.value === '') return true
  const group = groups.value.find((candidate) => candidate.id === selectedGroupId.value)
  return group?.isVerified ?? false
})

const filledDrafts = computed(() => drafts.value.filter((draft) => draft.url.trim().length > 0))

const canSubmit = computed(
  () => rightsAttested.value && filledDrafts.value.length > 0 && !submitting.value
)

function addRow(): void {
  if (drafts.value.length < MAX_SOURCES) drafts.value.push(emptyDraft())
}

function removeRow(index: number): void {
  drafts.value.splice(index, 1)
  if (drafts.value.length === 0) drafts.value.push(emptyDraft())
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return

  submitting.value = true
  results.value = []

  try {
    const response = await catalogueApi.submitSources(props.episodeId, {
      rightsAttested: true,
      ...(selectedGroupId.value === '' ? {} : { groupId: selectedGroupId.value }),
      sources: filledDrafts.value.map((draft) => ({
        url: draft.url.trim(),
        kind: draft.kind,
        ...(draft.audioLanguage === ''
          ? {}
          : { audioLanguage: draft.audioLanguage as SourceLanguage }),
        ...(draft.subtitleLanguage === ''
          ? {}
          : { subtitleLanguage: draft.subtitleLanguage as SourceLanguage }),
        ...(draft.qualityHint === '' ? {} : { qualityHint: draft.qualityHint as QualityHint })
      }))
    })

    results.value = response.results

    toast.success(
      response.publishedImmediately
        ? t('sources.publishedCount', { count: response.acceptedCount })
        : t('sources.queuedCount', { count: response.acceptedCount })
    )

    // Only the rows that failed are kept, so a retry does not resubmit the
    // ones that already succeeded as duplicates.
    const rejected = new Set(
      response.results.filter((result) => !result.accepted).map((result) => result.url)
    )

    drafts.value = filledDrafts.value.filter((draft) => rejected.has(draft.url.trim()))
    if (drafts.value.length === 0) {
      drafts.value = [emptyDraft()]
      rightsAttested.value = false
    }

    emit('submitted')
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Card variant="glass" class="space-y-4">
    <div class="flex items-center justify-between gap-4 flex-wrap">
      <h3 class="text-lg font-semibold text-text-primary">{{ t('sources.addTitle') }}</h3>

      <!-- Stated up front: whether this will be live or queued is the thing a
           submitter most wants to know before typing. -->
      <span
        class="px-3 py-1 rounded-full text-xs font-medium"
        :class="publishesImmediately ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'"
      >
        {{ publishesImmediately ? t('sources.willPublish') : t('sources.willQueue') }}
      </span>
    </div>

    <div v-if="groupOptions.length > 0">
      <label class="block text-sm text-text-secondary mb-1">{{ t('sources.submitAs') }}</label>
      <Select v-model="selectedGroupId" :options="groupOptions" size="sm" />
    </div>

    <!-- Draft rows -->
    <div class="space-y-3">
      <div
        v-for="(draft, index) in drafts"
        :key="index"
        class="glass-light rounded-lg p-3 space-y-2"
      >
        <div class="flex gap-2">
          <Input
            v-model="draft.url"
            type="url"
            :placeholder="t('sources.urlPlaceholder')"
            class="flex-1"
            variant="glass"
          />
          <Button
            v-if="drafts.length > 1"
            variant="ghost"
            size="sm"
            type="button"
            @click="removeRow(index)"
          >
            <Trash2 :size="16" />
          </Button>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('sources.kindLabel') }}</label>
            <Select v-model="draft.kind" :options="kindOptions" size="sm" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('sources.audio') }}</label>
            <Select v-model="draft.audioLanguage" :options="languageOptions" size="sm" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('sources.subtitles') }}</label>
            <Select v-model="draft.subtitleLanguage" :options="languageOptions" size="sm" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('player.quality') }}</label>
            <Select v-model="draft.qualityHint" :options="qualityOptions" size="sm" />
          </div>
        </div>
      </div>
    </div>

    <Button
      v-if="drafts.length < MAX_SOURCES"
      variant="ghost"
      size="sm"
      type="button"
      @click="addRow"
    >
      <Plus :size="16" />
      {{ t('sources.addAnother') }}
    </Button>

    <!-- Per-URL outcome. Partial success is the normal case. -->
    <div v-if="results.length > 0" class="space-y-1">
      <div
        v-for="result in results"
        :key="result.url"
        class="text-xs flex items-start gap-2"
        :class="result.accepted ? 'text-green-300' : 'text-red-300'"
      >
        <span class="shrink-0">{{ result.accepted ? '✓' : '✕' }}</span>
        <span class="truncate">{{ result.url }}</span>
        <span v-if="result.provider" class="text-text-muted shrink-0">{{ result.provider }}</span>
        <span v-if="result.error" class="text-text-muted">— {{ result.error }}</span>
      </div>
    </div>

    <!-- The attestation. Its wording is stored verbatim server-side with a
         timestamp, so this text is a legal record, not a formality. -->
    <label class="flex items-start gap-2 text-sm text-text-secondary">
      <input v-model="rightsAttested" type="checkbox" class="accent-primary mt-1" />
      <span>{{ t('sources.rightsAttestation') }}</span>
    </label>

    <div class="flex justify-end">
      <Button variant="primary" :disabled="!canSubmit" @click="submit">
        <Upload :size="18" />
        {{ submitting ? t('common.saving') : t('sources.submit') }}
      </Button>
    </div>
  </Card>
</template>
