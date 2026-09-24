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
import { Crown, Layers, Pencil, Plus, Trash2, Users, Video } from 'lucide-vue-next'
import { EPISODE_CREDIT_ROLES, type EpisodeCreditRole, type EpisodeCreditsSetBody } from '@playanime/contracts'
import { catalogueApi, translatorsApi, AbortError, type EditableEpisode } from '@/api'
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
import BulkLinkImport from './BulkLinkImport.vue'

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

/** The next unused episode number — the sensible default starting point for both a single new episode and a bulk-pasted list. */
const nextEpisodeNumber = computed(() =>
  episodes.value.reduce((max, episode) => Math.max(max, episode.number), 0) + 1
)

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
  isRecap: false,
  earlyAccessUntil: ''
})

function openCreate(): void {
  isCreating.value = true
  editing.value = null
  form.value = {
    number: String(nextEpisodeNumber.value),
    title: '',
    synopsis: '',
    airedAt: '',
    durationSeconds: '',
    introStartSeconds: '',
    introEndSeconds: '',
    outroStartSeconds: '',
    isFiller: false,
    isRecap: false,
    earlyAccessUntil: ''
  }
}

/** `datetime-local` input value (`YYYY-MM-DDTHH:mm`, no timezone) from an ISO timestamp, in the browser's own local time. */
function toDatetimeLocal(iso: string | null): string {
  if (iso === null) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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
    isRecap: episode.isRecap,
    earlyAccessUntil: toDatetimeLocal(episode.earlyAccessUntil)
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

  const earlyAccessUntil = form.value.earlyAccessUntil.trim()

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
    isRecap: form.value.isRecap,
    earlyAccessUntil: earlyAccessUntil.length === 0 ? null : new Date(earlyAccessUntil).toISOString()
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

/* -------------------------------------------------------------------------- */
/* Credits — who translated/corrected/QC'd/typeset this episode                */
/* -------------------------------------------------------------------------- */

interface GroupMemberOption {
  userId: string
  label: string
}

interface CreditGroupOption {
  id: string
  slug: string
  label: string
}

const managingCredits = ref<EditableEpisode | null>(null)
const creditsGroupId = ref('')
const creditsLoading = ref(false)
const creditsSaving = ref(false)
const groupMembers = ref<GroupMemberOption[]>([])
/** One array of member ids per role — the form's own working state, not the wire shape. */
const creditsByRole = ref<Record<EpisodeCreditRole, string[]>>({
  translation: [],
  correction: [],
  qc: [],
  typesetting: []
})

/**
 * Groups the credits editor offers — the caller's own memberships, plus
 * whichever group actually added this episode (added even when the acting
 * viewer, typically staff moderating credits, isn't a member of it). Without
 * that second part, a staff member with no memberships of their own always
 * saw an empty group list and "this group has no members yet," regardless
 * of who really uploaded the episode.
 */
const creditGroupOptions = ref<CreditGroupOption[]>([])

async function openCredits(episode: EditableEpisode): Promise<void> {
  managingCredits.value = episode
  creditsByRole.value = { translation: [], correction: [], qc: [], typesetting: [] }
  groupMembers.value = []
  creditsLoading.value = true

  const options = new Map<string, CreditGroupOption>(
    groups.value.map((group) => [group.id, { id: group.id, slug: group.slug, label: group.name }])
  )
  if (episode.createdByGroupId !== null && episode.createdByGroupSlug !== null) {
    options.set(episode.createdByGroupId, {
      id: episode.createdByGroupId,
      slug: episode.createdByGroupSlug,
      label: episode.createdByGroupName ?? episode.createdByGroupSlug
    })
  }
  creditGroupOptions.value = [...options.values()]
  creditsGroupId.value = episode.createdByGroupId ?? groups.value[0]?.id ?? ''

  await loadCreditsForGroup(episode)
  creditsLoading.value = false
}

/** Reloads the member list and existing credit selections for whichever group is currently selected in the dialog. */
async function loadCreditsForGroup(episode: EditableEpisode): Promise<void> {
  creditsByRole.value = { translation: [], correction: [], qc: [], typesetting: [] }
  groupMembers.value = []
  if (creditsGroupId.value === '') return

  try {
    const selected = creditGroupOptions.value.find((option) => option.id === creditsGroupId.value)
    const [existing, group] = await Promise.all([
      catalogueApi.episodeCredits(episode.id),
      selected === undefined ? Promise.resolve(null) : translatorsApi.bySlug(selected.slug)
    ])

    groupMembers.value = (group?.members ?? []).map((member) => ({
      userId: member.userId,
      label: member.displayName ?? member.username
    }))

    for (const credit of existing) {
      if (credit.groupId !== creditsGroupId.value) continue
      creditsByRole.value[credit.role].push(credit.userId)
    }
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}

async function onCreditsGroupChange(): Promise<void> {
  const episode = managingCredits.value
  if (episode === null) return
  creditsLoading.value = true
  await loadCreditsForGroup(episode)
  creditsLoading.value = false
}

function closeCredits(): void {
  managingCredits.value = null
}

async function saveCredits(): Promise<void> {
  const episode = managingCredits.value
  if (episode === null || creditsGroupId.value === '') return

  creditsSaving.value = true

  const credits: EpisodeCreditsSetBody['credits'] = EPISODE_CREDIT_ROLES.flatMap((role) =>
    creditsByRole.value[role].map((userId) => ({ userId, role }))
  )

  try {
    await catalogueApi.setEpisodeCredits(episode.id, { credits, groupId: creditsGroupId.value })
    toast.success(t('catalogue.credits.saved'))
    closeCredits()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    creditsSaving.value = false
  }
}
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
        <BulkLinkImport :slug="slug" :next-episode-number="nextEpisodeNumber" @imported="load" />
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
            <span
              v-if="episode.earlyAccessUntil && new Date(episode.earlyAccessUntil) > new Date()"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-primary/20 text-primary"
            >
              <Crown :size="12" />
              {{ t('admin.dashboard.vip.until') }}: {{ new Date(episode.earlyAccessUntil).toLocaleString() }}
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
          <Button variant="glass" size="sm" @click="openCredits(episode)">
            <Users :size="16" />
            {{ t('catalogue.credits.action') }}
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

        <div>
          <label class="flex items-center gap-1 text-xs text-text-muted mb-1">
            <Crown :size="12" />
            {{ t('catalogue.earlyAccessUntil') }}
          </label>
          <Input v-model="form.earlyAccessUntil" type="datetime-local" variant="glass" />
          <p class="text-xs text-text-muted mt-1">{{ t('catalogue.earlyAccessUntilHint') }}</p>
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

    <!-- Credits for one episode -->
    <Modal :model-value="managingCredits !== null" @update:model-value="closeCredits">
      <div v-if="managingCredits" class="space-y-4 p-2 max-h-[75vh] overflow-y-auto">
        <h3 class="text-xl font-semibold text-text-primary">
          {{ t('catalogue.credits.title', { number: managingCredits.number }) }}
        </h3>

        <div v-if="creditGroupOptions.length > 1">
          <label class="block text-xs text-text-muted mb-1">{{ t('catalogue.credits.group') }}</label>
          <Select
            v-model="creditsGroupId"
            :options="creditGroupOptions.map((option) => ({ label: option.label, value: option.id }))"
            @update:model-value="onCreditsGroupChange"
          />
        </div>
        <p v-else-if="creditGroupOptions.length === 1" class="text-sm text-text-secondary">
          {{ t('catalogue.credits.group') }}: <span class="text-text-primary font-medium">{{ creditGroupOptions[0]?.label }}</span>
        </p>
        <p v-else class="py-8 text-center text-text-secondary text-sm">
          {{ t('catalogue.credits.noGroup') }}
        </p>

        <div v-if="creditGroupOptions.length > 0 && creditsLoading" class="py-8 text-center text-text-secondary">
          {{ t('common.loading') }}
        </div>

        <div
          v-else-if="creditGroupOptions.length > 0 && groupMembers.length === 0"
          class="py-8 text-center text-text-secondary text-sm"
        >
          {{ t('catalogue.credits.noMembers') }}
        </div>

        <div v-else-if="creditGroupOptions.length > 0" class="space-y-4">
          <div v-for="role in EPISODE_CREDIT_ROLES" :key="role">
            <label class="block text-xs text-text-muted mb-1">{{ t(`catalogue.credits.role.${role}`) }}</label>
            <div class="flex flex-wrap gap-3">
              <label
                v-for="member in groupMembers"
                :key="member.userId"
                class="flex items-center gap-1.5 text-sm text-text-secondary"
              >
                <input
                  v-model="creditsByRole[role]"
                  :value="member.userId"
                  type="checkbox"
                  class="accent-primary"
                />
                {{ member.label }}
              </label>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="closeCredits">{{ t('common.cancel') }}</Button>
          <Button
            variant="primary"
            :disabled="creditsSaving || creditsLoading || creditGroupOptions.length === 0"
            @click="saveCredits"
          >
            {{ creditsSaving ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
