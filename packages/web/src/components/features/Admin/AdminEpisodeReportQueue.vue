<script setup lang="ts">
/**
 * Episode report queue — platform staff side. A group credited on the
 * reported episode can also resolve it themselves from their own group
 * dashboard (`/translator/dashboard/:slug`, "reports" tab); this view sees
 * every report regardless of which group (if any) is credited.
 */

import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Check, Flag, X } from 'lucide-vue-next'
import type { EpisodeReportDto, EpisodeReportStatus } from '@playanime/contracts'
import { AbortError, episodeReportsApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

type Filter = 'open' | 'all'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const reports = ref<EpisodeReportDto[]>([])
const loading = ref(true)
const filter = ref<Filter>('open')

let controller: AbortController | null = null

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const status: EpisodeReportStatus | undefined = filter.value === 'open' ? 'open' : undefined
    reports.value = await episodeReportsApi.list(status, 50, request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    reports.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)
watch(filter, load)
onUnmounted(() => controller?.abort())

/* -------------------------------------------------------------------------- */
/* Resolve                                                                     */
/* -------------------------------------------------------------------------- */

const resolving = ref<EpisodeReportDto | null>(null)
const resolveReply = ref('')
const submitting = ref(false)

function openResolve(report: EpisodeReportDto): void {
  resolving.value = report
  resolveReply.value = ''
}

function closeResolve(): void {
  resolving.value = null
}

async function submitResolve(status: 'action_taken' | 'dismissed'): Promise<void> {
  const report = resolving.value
  if (report === null) return

  submitting.value = true

  try {
    await episodeReportsApi.resolve(report.id, {
      status,
      ...(resolveReply.value.trim().length > 0 ? { replyText: resolveReply.value.trim() } : {})
    })
    toast.success(t('admin.episodeReports.resolved'))
    closeResolve()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <div class="admin-episode-reports space-y-6">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-text-primary">{{ t('admin.episodeReports.title') }}</h2>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'open' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'open'"
        >
          {{ t('admin.episodeReports.filterOpen') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="filter === 'all' ? 'bg-primary text-white' : 'text-text-secondary hover:bg-white/10'"
          @click="filter = 'all'"
        >
          {{ t('admin.episodeReports.filterAll') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 3" :key="i" variant="glass" class="p-5 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-1/2"></div>
      </Card>
    </div>

    <template v-else-if="reports.length > 0">
      <Card
        v-for="report in reports"
        :key="report.id"
        variant="glass"
        class="p-5 flex items-start justify-between gap-4 flex-wrap"
      >
        <div class="flex items-start gap-3 min-w-0 flex-1">
          <Flag :size="20" class="text-text-muted mt-1 shrink-0" />
          <div class="min-w-0">
            <p class="font-semibold text-text-primary">
              {{ report.animeTitle }} — {{ t('anime.episode') }} {{ report.episodeNumber }}
            </p>
            <p class="text-sm text-text-secondary mt-1">{{ t(`episodeReports.reasons.${report.reason}`) }}</p>
            <p v-if="report.description" class="text-sm text-text-muted mt-1">{{ report.description }}</p>
            <p class="text-xs text-text-muted mt-2">
              {{ t('episodeReports.reportedBy', { username: report.reporterUsername }) }} · {{ formatDate(report.createdAt) }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <span
            class="px-2 py-0.5 rounded-full text-xs font-medium"
            :class="
              report.status === 'open'
                ? 'bg-primary/20 text-primary'
                : report.status === 'action_taken'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-white/10 text-text-muted'
            "
          >
            {{ t(`episodeReports.statuses.${report.status}`) }}
          </span>
          <Button v-if="report.status === 'open'" variant="glass" size="sm" @click="openResolve(report)">
            {{ t('admin.episodeReports.resolve') }}
          </Button>
        </div>
      </Card>
    </template>

    <Card v-else variant="glass" class="p-12 text-center text-text-secondary">
      <Flag :size="40" class="mx-auto mb-3 text-text-muted" />
      {{ filter === 'open' ? t('admin.episodeReports.emptyOpen') : t('admin.episodeReports.emptyAll') }}
    </Card>

    <!-- Resolve dialog -->
    <Modal :model-value="resolving !== null" @update:model-value="closeResolve">
      <div v-if="resolving" class="space-y-4 p-2">
        <div>
          <h3 class="text-lg font-semibold text-text-primary">
            {{ resolving.animeTitle }} — {{ t('anime.episode') }} {{ resolving.episodeNumber }}
          </h3>
          <p class="text-sm text-text-secondary">{{ t(`episodeReports.reasons.${resolving.reason}`) }}</p>
        </div>

        <div>
          <label class="block text-sm text-text-secondary mb-1">{{ t('admin.episodeReports.replyLabel') }}</label>
          <Textarea v-model="resolveReply" :rows="3" :maxlength="2000" :placeholder="t('admin.episodeReports.replyPlaceholder')" />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="closeResolve">{{ t('common.cancel') }}</Button>
          <Button variant="ghost" class="text-red-400 hover:text-red-300" :disabled="submitting" @click="submitResolve('dismissed')">
            <X :size="16" />
            {{ t('episodeReports.dismiss') }}
          </Button>
          <Button variant="primary" :disabled="submitting" @click="submitResolve('action_taken')">
            <Check :size="16" />
            {{ t('episodeReports.markFixed') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
