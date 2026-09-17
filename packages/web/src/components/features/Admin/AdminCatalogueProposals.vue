<script setup lang="ts">
/**
 * Cross-group catalogue edit proposals.
 *
 * A non-owning group's editor cannot write to a title directly — their edit
 * lands here instead, pending a decision. Approving applies it through the
 * same path a direct edit would take (so it is subject to every rule a
 * direct edit is); rejecting leaves the catalogue untouched. Either way the
 * proposer is notified.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Check, Clock, FileEdit, X } from 'lucide-vue-next'
import type { CatalogueEditProposal } from '@playanime/contracts'
import { AbortError, catalogueApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const queue = ref<CatalogueEditProposal[]>([])
const loading = ref(true)

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const page = await catalogueApi.proposalQueue(request.signal)
    queue.value = page.proposals
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    queue.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)
onUnmounted(() => controller?.abort())

const target = ref<CatalogueEditProposal | null>(null)
const approving = ref(false)
const reason = ref('')
const submitting = ref(false)

function open(proposal: CatalogueEditProposal, approve: boolean): void {
  target.value = proposal
  approving.value = approve
  reason.value = ''
}

function close(): void {
  target.value = null
}

function fieldLabel(field: string): string {
  const key = `catalogue.auditFields.${field}`
  const label = t(key)
  return label === key ? field : label
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ')
  if (typeof value === 'boolean') return value ? t('common.confirm') : t('common.cancel')
  return String(value)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  )
}

const canSubmit = computed(() => approving.value || reason.value.trim().length > 0)

async function submit(): Promise<void> {
  const proposal = target.value
  if (proposal === null || !canSubmit.value) return

  submitting.value = true

  try {
    await catalogueApi.decideProposal(proposal.id, {
      approve: approving.value,
      ...(reason.value.trim().length > 0 ? { reason: reason.value.trim() } : {})
    })

    toast.success(t('moderation.decisionSaved'))
    close()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="admin-catalogue-proposals space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-text-primary">{{ t('catalogue.proposalsQueueTitle') }}</h2>
      <span class="text-sm text-text-secondary">
        {{ t('moderation.pendingCount', { count: queue.length }) }}
      </span>
    </div>

    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 3" :key="i" variant="glass" class="p-5 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-1/2"></div>
      </Card>
    </div>

    <template v-else-if="queue.length > 0">
      <Card v-for="proposal in queue" :key="proposal.id" variant="glass" class="p-5">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="font-semibold text-text-primary">
                {{ proposal.animeTitle || '—' }}
              </span>
              <span v-if="proposal.targetType === 'episode'" class="text-text-muted">
                {{ t('anime.episode') }} {{ proposal.episodeNumber }}
              </span>
              <span class="px-2 py-0.5 rounded-full text-xs bg-dark-600 text-text-muted flex items-center gap-1">
                <FileEdit :size="12" />
                {{ proposal.targetType === 'episode' ? t('anime.episode') : t('anime.title') }}
              </span>
            </div>

            <div class="flex items-center gap-4 text-xs text-text-muted flex-wrap mb-2">
              <span>
                {{ proposal.proposedByUsername ?? t('moderation.unknownSubmitter') }}
                <template v-if="proposal.proposedByGroupName"> · {{ proposal.proposedByGroupName }}</template>
              </span>
              <span class="flex items-center gap-1">
                <Clock :size="12" />
                {{ formatDate(proposal.createdAt) }}
              </span>
            </div>

            <div class="space-y-1">
              <div
                v-for="(value, field) in proposal.changes"
                :key="field"
                class="text-xs text-text-muted grid grid-cols-[auto_1fr] items-baseline gap-2"
              >
                <span class="font-medium text-text-secondary">{{ fieldLabel(String(field)) }}</span>
                <span class="truncate text-text-primary">{{ formatValue(value) }}</span>
              </div>
            </div>
          </div>

          <div class="flex gap-2 shrink-0 flex-wrap">
            <Button variant="primary" size="sm" @click="open(proposal, true)">
              <Check :size="16" />
              {{ t('moderation.approve') }}
            </Button>
            <Button variant="ghost" size="sm" @click="open(proposal, false)">
              <X :size="16" />
              {{ t('moderation.reject') }}
            </Button>
          </div>
        </div>
      </Card>
    </template>

    <Card v-else variant="glass" class="p-12 text-center text-text-secondary">
      {{ t('catalogue.proposalsQueueEmpty') }}
    </Card>

    <Modal :model-value="target !== null" @update:model-value="close">
      <div v-if="target" class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">
          {{ approving ? t('moderation.approve') : t('moderation.reject') }}
        </h3>

        <p class="text-sm text-text-secondary">{{ target.animeTitle }}</p>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.reason') }}
            <span v-if="!approving">*</span>
          </label>
          <Textarea v-model="reason" :rows="3" :placeholder="t('moderation.reasonHint')" />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
          <Button variant="primary" :disabled="submitting || !canSubmit" @click="submit">
            {{ submitting ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
