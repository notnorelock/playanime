<script setup lang="ts">
/**
 * Episode management for one title.
 *
 * Bulk creation is the primary path because a season is added as a range far
 * more often than one episode at a time. Numbers that already exist are skipped
 * and reported rather than failing, so re-running a range after adding a few by
 * hand is safe.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Layers, Pencil, Plus, Trash2, Video } from 'lucide-vue-next'
import { catalogueApi, AbortError, type EditableEpisode } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useCataloguePermissions } from '@/composables/useCataloguePermissions'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'
import SourceManager from './SourceManager.vue'

interface Props {
  slug: string
}

const props = defineProps<Props>()

const { t } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()
const { groups, permissions } = useCataloguePermissions()

const episodes = ref<EditableEpisode[]>([])
const loading = ref(true)
const saving = ref(false)

let controller: AbortController | null = null

const groupOptions = computed(() => [
  ...(permissions.value.canModerate ? [{ label: t('sources.asStaff'), value: '' }] : []),
  ...groups.value.map((group) => ({ label: group.name, value: group.id }))
])

const selectedGroupId = ref(groups.value[0]?.id ?? '')

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    episodes.value = await catalogueApi.episodes(props.slug, request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    episodes.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)

onUnmounted(() => {
  controller?.abort()
})

/** Group to attribute a write to, omitted when acting as staff. */
function groupPayload(): { groupId?: string } {
  return selectedGroupId.value === '' ? {} : { groupId: selectedGroupId.value }
}

/* -------------------------------------------------------------------------- */
/* Bulk creation                                                               */
/* -------------------------------------------------------------------------- */

const bulkOpen = ref(false)
const bulkFrom = ref('1')
const bulkTo = ref('12')
const bulkDuration = ref('1440')

async function createRange(): Promise<void> {
  const from = Number.parseInt(bulkFrom.value, 10)
  const to = Number.parseInt(bulkTo.value, 10)
  const duration = Number.parseInt(bulkDuration.value, 10)

  if (!Number.isFinite(from) || !Number.isFinite(to)) return

  saving.value = true

  try {
    const result = await catalogueApi.createEpisodeRange(props.slug, {
      from,
      to,
      ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}),
      ...groupPayload()
    })

    toast.success(
      result.skipped.length > 0
        ? t('catalogue.episodesCreatedSkipped', {
            count: result.created,
            skipped: result.skipped.length
          })
        : t('catalogue.episodesCreated', { count: result.created })
    )

    bulkOpen.value = false
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

/* -------------------------------------------------------------------------- */
/* Single episode editing                                                      */
/* -------------------------------------------------------------------------- */

const editing = ref<EditableEpisode | null>(null)
const isCreating = ref(false)

const form = ref({
  number: '1',
  title: '',
  synopsis: '',
  airedAt: '',
  durationSeconds: '',
  introStartSeconds: '',
  introEndSeconds: '',
  outroStartSeconds: '',
  isFiller: false,
  isRecap: false
})

function openCreate(): void {
  const highest = episodes.value.reduce((max, episode) => Math.max(max, episode.number), 0)

  isCreating.value = true
  editing.value = null
  form.value = {
    number: String(highest + 1),
    title: '',
    synopsis: '',
    airedAt: '',
    durationSeconds: '',
    introStartSeconds: '',
    introEndSeconds: '',
    outroStartSeconds: '',
    isFiller: false,
    isRecap: false
  }
}

function openEdit(episode: EditableEpisode): void {
  isCreating.value = false
  editing.value = episode
  form.value = {
    number: String(episode.number),
    title: episode.title ?? '',
    synopsis: '',
    airedAt: episode.airedAt ?? '',
    durationSeconds: episode.durationSeconds === null ? '' : String(episode.durationSeconds),
    introStartSeconds:
      episode.introStartSeconds === null ? '' : String(episode.introStartSeconds),
    introEndSeconds: episode.introEndSeconds === null ? '' : String(episode.introEndSeconds),
    outroStartSeconds:
      episode.outroStartSeconds === null ? '' : String(episode.outroStartSeconds),
    isFiller: episode.isFiller,
    isRecap: episode.isRecap
  }
}

function closeEditor(): void {
  editing.value = null
  isCreating.value = false
}

/** Empty means "not set", which the contract models as null. */
function numberOrNull(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function textOrNull(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim()
}

async function save(): Promise<void> {
  const number = Number.parseInt(form.value.number, 10)
  if (!Number.isFinite(number)) return

  saving.value = true

  const payload = {
    number,
    title: textOrNull(form.value.title),
    synopsis: textOrNull(form.value.synopsis),
    airedAt: textOrNull(form.value.airedAt),
    durationSeconds: numberOrNull(form.value.durationSeconds),
    introStartSeconds: numberOrNull(form.value.introStartSeconds),
    introEndSeconds: numberOrNull(form.value.introEndSeconds),
    outroStartSeconds: numberOrNull(form.value.outroStartSeconds),
    isFiller: form.value.isFiller,
    isRecap: form.value.isRecap
  }

  try {
    if (isCreating.value) {
      await catalogueApi.createEpisode(props.slug, { ...payload, ...groupPayload() })
    } else if (editing.value !== null) {
      await catalogueApi.updateEpisode(editing.value.id, { ...payload, ...groupPayload() })
    }

    toast.success(t('catalogue.saved'))
    closeEditor()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    saving.value = false
  }
}

async function remove(episode: EditableEpisode): Promise<void> {
  const confirmed = await confirm({
    message: t('catalogue.confirmDeleteEpisode', { number: episode.number }),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })

  if (!confirmed) return

  try {
    await catalogueApi.deleteEpisode(episode.id)
    toast.success(t('catalogue.episodeDeleted'))
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

const managingSources = ref<EditableEpisode | null>(null)
</script>

<template>
  <div class="episode-manager space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-text-primary">{{ t('anime.episodes') }}</h2>

      <div class="flex gap-2 flex-wrap items-center">
        <Select
          v-if="groupOptions.length > 1"
          v-model="selectedGroupId"
          :options="groupOptions"
          size="sm"
        />
        <Button variant="glass" size="sm" @click="bulkOpen = true">
          <Layers :size="16" />
          {{ t('catalogue.addRange') }}
        </Button>
        <Button variant="primary" size="sm" @click="openCreate">
          <Plus :size="16" />
          {{ t('catalogue.addEpisode') }}
        </Button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-2">
      <Card v-for="i in 4" :key="i" variant="glass" class="p-4 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/4"></div>
      </Card>
    </div>

    <!-- Episode rows -->
    <template v-else>
      <Card
        v-for="episode in episodes"
        :key="episode.id"
        variant="glass"
        class="p-4 flex items-center justify-between gap-4 flex-wrap"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-primary">{{ episode.number }}</span>
            <span class="text-text-primary truncate">
              {{ episode.title ?? t('catalogue.untitled') }}
            </span>

            <span v-if="episode.isFiller" class="px-2 py-0.5 rounded text-xs bg-dark-600 text-text-muted">
              {{ t('anime.filler') }}
            </span>
            <span v-if="episode.isRecap" class="px-2 py-0.5 rounded text-xs bg-dark-600 text-text-muted">
              {{ t('anime.recap') }}
            </span>
          </div>

          <div class="flex items-center gap-3 text-xs text-text-muted mt-1 flex-wrap">
            <span v-if="episode.airedAt">{{ episode.airedAt }}</span>
            <span class="flex items-center gap-1">
              <Video :size="12" />
              {{ episode.sourceCount }}
            </span>
            <span v-if="episode.pendingSourceCount > 0" class="text-yellow-300">
              +{{ episode.pendingSourceCount }} {{ t('sources.status.pending') }}
            </span>
          </div>
        </div>

        <div class="flex gap-2 shrink-0">
          <Button variant="glass" size="sm" @click="managingSources = episode">
            <Video :size="16" />
            {{ t('anime.sources') }}
          </Button>
          <Button variant="ghost" size="sm" @click="openEdit(episode)">
            <Pencil :size="16" />
          </Button>
          <Button variant="ghost" size="sm" @click="remove(episode)">
            <Trash2 :size="16" />
          </Button>
        </div>
      </Card>

      <p v-if="episodes.length === 0" class="text-center text-text-secondary py-8">
        {{ t('anime.noEpisodes') }}
      </p>
    </template>

    <!-- Bulk range -->
    <Modal :model-value="bulkOpen" @update:model-value="bulkOpen = false">
      <div class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">{{ t('catalogue.addRange') }}</h3>
        <p class="text-sm text-text-secondary">{{ t('catalogue.addRangeHint') }}</p>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.from') }}</label>
            <Input v-model="bulkFrom" type="number" min="0" variant="glass" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.to') }}</label>
            <Input v-model="bulkTo" type="number" min="0" variant="glass" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">
              {{ t('catalogue.durationSeconds') }}
            </label>
            <Input v-model="bulkDuration" type="number" min="0" variant="glass" />
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="bulkOpen = false">{{ t('common.cancel') }}</Button>
          <Button variant="primary" :disabled="saving" @click="createRange">
            {{ saving ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </Modal>

    <!-- Single episode editor -->
    <Modal
      :model-value="editing !== null || isCreating"
      @update:model-value="closeEditor"
    >
      <div class="space-y-4 p-2 max-h-[70vh] overflow-y-auto">
        <h3 class="text-xl font-semibold text-text-primary">
          {{ isCreating ? t('catalogue.addEpisode') : t('catalogue.editEpisode') }}
        </h3>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('anime.episode') }}</label>
            <Input v-model="form.number" type="number" min="0" variant="glass" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.airedAt') }}</label>
            <Input v-model="form.airedAt" type="date" variant="glass" />
          </div>
        </div>

        <div>
          <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.titleOriginal') }}</label>
          <Input v-model="form.title" variant="glass" />
        </div>

        <div>
          <label class="block text-xs text-text-muted mb-1">{{ t('anime.synopsis') }}</label>
          <Textarea v-model="form.synopsis" :rows="3" variant="glass" />
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label class="block text-xs text-text-muted mb-1">
              {{ t('catalogue.durationSeconds') }}
            </label>
            <Input v-model="form.durationSeconds" type="number" min="0" variant="glass" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.introStart') }}</label>
            <Input v-model="form.introStartSeconds" type="number" min="0" variant="glass" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.introEnd') }}</label>
            <Input v-model="form.introEndSeconds" type="number" min="0" variant="glass" />
          </div>
          <div>
            <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.outroStart') }}</label>
            <Input v-model="form.outroStartSeconds" type="number" min="0" variant="glass" />
          </div>
        </div>

        <div class="flex gap-4">
          <label class="flex items-center gap-2 text-sm text-text-secondary">
            <input v-model="form.isFiller" type="checkbox" class="accent-primary" />
            {{ t('anime.filler') }}
          </label>
          <label class="flex items-center gap-2 text-sm text-text-secondary">
            <input v-model="form.isRecap" type="checkbox" class="accent-primary" />
            {{ t('anime.recap') }}
          </label>
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="closeEditor">{{ t('common.cancel') }}</Button>
          <Button variant="primary" :disabled="saving" @click="save">
            {{ saving ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </Modal>

    <!-- Sources for one episode -->
    <Modal
      :model-value="managingSources !== null"
      size="lg"
      @update:model-value="managingSources = null"
    >
      <div v-if="managingSources" class="p-2 max-h-[75vh] overflow-y-auto">
        <SourceManager
          :episode-id="managingSources.id"
          :episode-number="managingSources.number"
        />
      </div>
    </Modal>
  </div>
</template>
