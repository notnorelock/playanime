<script setup lang="ts">
/**
 * Takedown / report review queue.
 *
 * Oldest first, same reasoning as `AdminSourceQueue.vue`. Only an
 * anime-targeted report has a real approval effect today — hiding the title
 * (`anime.deletedAt`) and blocking its AniList/MAL id from resubmission —
 * so every row here is currently an anime report; other target types can
 * still be dismissed but have no approval effect yet.
 *
 * Two outcomes:
 *   approve — the title is removed from the catalogue, resubmission is blocked
 *   dismiss — no catalogue write, the report is closed
 *
 * Both require a reason (the audit trail) and accept an optional resolution
 * note shown to the reporter, mirroring `AdminSourceQueue.vue`'s decision
 * dialog shape.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { AlertTriangle, Ban, Check, Clock } from 'lucide-vue-next'
import type { PendingReportDto } from '@playanime/contracts'
import { AbortError, adminApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

type Decision = 'approve' | 'dismiss'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const queue = ref<PendingReportDto[]>([])
const loading = ref(true)

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    queue.value = await adminApi.pendingReports(undefined, 50, request.signal)
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

const target = ref<PendingReportDto | null>(null)
const decision = ref<Decision | null>(null)
const reason = ref('')
const resolution = ref('')
const submitting = ref(false)

const isApprove = computed(() => decision.value === 'approve')

function open(report: PendingReportDto, next: Decision): void {
  target.value = report
  decision.value = next
  reason.value = ''
  resolution.value = ''
}

function close(): void {
  target.value = null
  decision.value = null
}

async function submit(): Promise<void> {
  const report = target.value
  const action = decision.value

  if (report === null || action === null || reason.value.trim().length === 0) return

  submitting.value = true

  try {
    await adminApi.decideReport(report.id, {
      approve: action === 'approve',
      reason: reason.value.trim(),
      ...(resolution.value.trim().length > 0 ? { resolution: resolution.value.trim() } : {})
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

function formatDate(value: string | null): string {
  if (value === null) return '—'
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  )
}

const dialogTitle = computed(() =>
  decision.value === 'approve' ? t('reports.approve') : t('reports.dismiss')
)
</script>

<template>
  <div class="admin-takedown-queue space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-text-primary">{{ t('reports.queueTitle') }}</h2>
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
      <Card v-for="report in queue" :key="report.id" variant="glass" class="p-5">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="font-semibold text-text-primary">
                {{ report.animeTitle ?? t('reports.unknownTarget') }}
              </span>
              <span class="px-2 py-0.5 rounded-full text-xs bg-dark-600 text-text-muted">
                {{ t(`reports.types.${report.type}`) }}
              </span>

              <span
                v-if="report.type === 'copyright'"
                class="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 flex items-center gap-1"
              >
                <AlertTriangle :size="12" />
                {{ t('reports.copyright') }}
              </span>
            </div>

            <p class="text-sm text-text-secondary mb-1">{{ report.reason }}</p>
            <p v-if="report.description" class="text-xs text-text-muted mb-2">
              {{ report.description }}
            </p>

            <div class="flex items-center gap-4 text-xs text-text-muted flex-wrap">
              <span>
                {{
                  report.reporterUsername ?? report.reporterName ?? report.reporterEmail ?? t('moderation.unknownSubmitter')
                }}
              </span>
              <span class="flex items-center gap-1">
                <Clock :size="12" />
                {{ formatDate(report.createdAt) }}
              </span>
              <span v-if="report.rightsHolderAttestedAt" class="text-green-300">
                {{ t('moderation.rightsAttested') }} {{ formatDate(report.rightsHolderAttestedAt) }}
              </span>
              <span v-else-if="report.type === 'copyright'" class="text-yellow-300">
                {{ t('moderation.noAttestation') }}
              </span>
              <span class="font-mono">{{ report.reference }}</span>
            </div>
          </div>

          <div class="flex gap-2 shrink-0 flex-wrap">
            <Button
              v-if="report.targetType === 'anime'"
              variant="primary"
              size="sm"
              @click="open(report, 'approve')"
            >
              <Ban :size="16" />
              {{ t('reports.approve') }}
            </Button>
            <Button variant="ghost" size="sm" @click="open(report, 'dismiss')">
              <Check :size="16" />
              {{ t('reports.dismiss') }}
            </Button>
          </div>
        </div>
      </Card>
    </template>

    <Card v-else variant="glass" class="p-12 text-center text-text-secondary">
      {{ t('reports.queueEmpty') }}
    </Card>

    <!-- Decision dialog -->
    <Modal :model-value="decision !== null" @update:model-value="close">
      <div v-if="target" class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">{{ dialogTitle }}</h3>

        <p class="text-sm text-text-secondary">{{ target.animeTitle ?? t('reports.unknownTarget') }}</p>

        <div
          v-if="isApprove"
          class="p-3 rounded-lg bg-red-500/10 border border-red-500/40 text-sm text-red-200"
        >
          {{ t('reports.approveWarning') }}
        </div>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.reason') }}
          </label>
          <Textarea v-model="reason" :rows="3" :placeholder="t('moderation.reasonHint')" />
        </div>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('reports.resolutionLabel') }}
          </label>
          <Textarea v-model="resolution" :rows="2" :placeholder="t('reports.resolutionHint')" />
        </div>

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
