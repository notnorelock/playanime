<script setup lang="ts">
/**
 * Source moderation queue.
 *
 * Oldest first, because a submission waiting longest is the one most likely to
 * be abandoned. Each row carries the submitter, the rights attestation
 * timestamp and the count of open reports — the three things a decision
 * actually turns on.
 *
 * Four outcomes, deliberately distinct:
 *   approve  — the source goes live
 *   reject   — wrong episode or bad metadata; the same URL may be resubmitted
 *   disable  — hidden but restorable
 *   block    — permanent; bars this exact resource from ever being added again
 *
 * Every one of them is audited and requires a reason, which is what makes a
 * later copyright enquiry answerable.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { AlertTriangle, Ban, Check, Clock, ExternalLink, EyeOff, X } from 'lucide-vue-next'
import type { PendingSourceDto } from '@playanime/contracts'
import { AbortError, adminApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

type Decision = 'approve' | 'reject' | 'disable' | 'block'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const queue = ref<PendingSourceDto[]>([])
const loading = ref(true)

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    queue.value = await adminApi.pendingSources(50, request.signal)
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

onUnmounted(() => {
  controller?.abort()
})

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

const target = ref<PendingSourceDto | null>(null)
const decision = ref<Decision | null>(null)
const reason = ref('')
const internalNote = ref('')
const notifySubmitter = ref(true)
const submitting = ref(false)

/** Blocking cannot be undone from the product, so it is called out. */
const isPermanent = computed(() => decision.value === 'block')

function open(source: PendingSourceDto, next: Decision): void {
  target.value = source
  decision.value = next
  reason.value = ''
  internalNote.value = ''
  notifySubmitter.value = true
}

function close(): void {
  target.value = null
  decision.value = null
}

async function submit(): Promise<void> {
  const source = target.value
  const action = decision.value

  if (source === null || action === null || reason.value.trim().length === 0) return

  submitting.value = true

  const body = {
    reason: reason.value.trim(),
    ...(internalNote.value.trim().length > 0 ? { internalNote: internalNote.value.trim() } : {}),
    notifySubmitter: notifySubmitter.value
  }

  try {
    if (action === 'approve') await adminApi.approveSource(source.id, body)
    else if (action === 'reject') await adminApi.rejectSource(source.id, body)
    else if (action === 'disable') await adminApi.disableSource(source.id, body)
    else await adminApi.blockSource(source.id, body)

    toast.success(t('moderation.decisionSaved'))
    close()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

function formatDate(value: string | null): string {
  if (value === null) return '—'
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  )
}

const dialogTitle = computed(() => {
  switch (decision.value) {
    case 'approve':
      return t('moderation.approve')
    case 'reject':
      return t('moderation.reject')
    case 'disable':
      return t('moderation.disable')
    default:
      return t('moderation.block')
  }
})
</script>

<template>
  <div class="admin-source-queue space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-text-primary">{{ t('moderation.queueTitle') }}</h2>
      <span class="text-sm text-text-secondary">
        {{ t('moderation.pendingCount', { count: queue.length }) }}
      </span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 3" :key="i" variant="glass" class="p-5 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-1/2"></div>
      </Card>
    </div>

    <!-- Queue -->
    <template v-else-if="queue.length > 0">
      <Card v-for="source in queue" :key="source.id" variant="glass" class="p-5">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="font-semibold text-text-primary">{{ source.animeTitle }}</span>
              <span class="text-text-muted">
                {{ t('anime.episode') }} {{ source.episodeNumber }}
              </span>
              <span class="px-2 py-0.5 rounded-full text-xs bg-dark-600 text-text-muted">
                {{ source.provider }}
              </span>

              <!-- Open reports are the strongest signal in the queue. -->
              <span
                v-if="source.openReportCount > 0"
                class="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 flex items-center gap-1"
              >
                <AlertTriangle :size="12" />
                {{ source.openReportCount }}
              </span>
            </div>

            <a
              :href="source.normalizedUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-primary hover:underline flex items-center gap-1 mb-2 truncate"
            >
              <ExternalLink :size="12" class="shrink-0" />
              <span class="truncate">{{ source.normalizedUrl }}</span>
            </a>

            <div class="flex items-center gap-4 text-xs text-text-muted flex-wrap">
              <span>{{ source.submittedByUsername ?? t('moderation.unknownSubmitter') }}</span>
              <span class="flex items-center gap-1">
                <Clock :size="12" />
                {{ formatDate(source.createdAt) }}
              </span>
              <!-- Its presence is what makes the submission legally answerable. -->
              <span v-if="source.rightsAttestedAt" class="text-green-300">
                {{ t('moderation.rightsAttested') }} {{ formatDate(source.rightsAttestedAt) }}
              </span>
              <span v-else class="text-yellow-300">{{ t('moderation.noAttestation') }}</span>
            </div>

            <p v-if="source.note" class="text-xs text-text-secondary mt-2">{{ source.note }}</p>
          </div>

          <div class="flex gap-2 shrink-0 flex-wrap">
            <Button variant="primary" size="sm" @click="open(source, 'approve')">
              <Check :size="16" />
              {{ t('moderation.approve') }}
            </Button>
            <Button variant="ghost" size="sm" @click="open(source, 'reject')">
              <X :size="16" />
              {{ t('moderation.reject') }}
            </Button>
            <Button variant="ghost" size="sm" @click="open(source, 'disable')">
              <EyeOff :size="16" />
            </Button>
            <Button variant="ghost" size="sm" @click="open(source, 'block')">
              <Ban :size="16" />
            </Button>
          </div>
        </div>
      </Card>
    </template>

    <Card v-else variant="glass" class="p-12 text-center text-text-secondary">
      {{ t('moderation.queueEmpty') }}
    </Card>

    <!-- Decision dialog -->
    <Modal :model-value="decision !== null" @update:model-value="close">
      <div v-if="target" class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">{{ dialogTitle }}</h3>

        <p class="text-sm text-text-secondary">
          {{ target.animeTitle }} — {{ t('anime.episode') }} {{ target.episodeNumber }}
        </p>

        <div
          v-if="isPermanent"
          class="p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-sm text-red-200"
        >
          {{ t('moderation.blockWarning') }}
        </div>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.reason') }}
          </label>
          <Textarea v-model="reason" :rows="3" :placeholder="t('moderation.reasonHint')" />
        </div>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('moderation.internalNote') }}
          </label>
          <Textarea v-model="internalNote" :rows="2" :placeholder="t('moderation.internalHint')" />
        </div>

        <label class="flex items-center gap-2 text-sm text-text-secondary">
          <input v-model="notifySubmitter" type="checkbox" class="accent-primary" />
          {{ t('moderation.notifySubmitter') }}
        </label>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
          <Button
            variant="primary"
            :disabled="submitting || reason.trim().length === 0"
            @click="submit"
          >
            {{ submitting ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
