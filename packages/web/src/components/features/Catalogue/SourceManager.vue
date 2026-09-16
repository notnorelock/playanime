<script setup lang="ts">
/**
 * Source management for one episode.
 *
 * Shows every source the caller may act on, including ones still awaiting
 * moderation — a submitter needs to see why a pending source has not appeared,
 * which the public listing deliberately never reveals.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { BadgeCheck, Clock, Trash2, XCircle } from 'lucide-vue-next'
import type { OwnedSourceDto, SourceStatus } from '@playanime/contracts'
import { AbortError, catalogueApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import SourceSubmitForm from './SourceSubmitForm.vue'

interface Props {
  episodeId: string
  episodeNumber?: number
}

const props = defineProps<Props>()

const { t } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()

const sources = ref<OwnedSourceDto[]>([])
const loading = ref(true)

let controller: AbortController | null = null

/** Only `active` is visible to viewers; everything else is explained in place. */
function statusTone(status: SourceStatus): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/20 text-green-300'
    case 'pending':
      return 'bg-yellow-500/20 text-yellow-300'
    case 'unavailable':
      return 'bg-orange-500/20 text-orange-300'
    default:
      return 'bg-red-500/20 text-red-300'
  }
}

const activeCount = computed(
  () => sources.value.filter((source) => source.status === 'active').length
)
const pendingCount = computed(
  () => sources.value.filter((source) => source.status === 'pending').length
)

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const response = await catalogueApi.sources(props.episodeId, request.signal)
    if (request.signal.aborted) return
    sources.value = response.sources
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    sources.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)

watch(() => props.episodeId, load)

onUnmounted(() => {
  controller?.abort()
})

async function withdraw(source: OwnedSourceDto): Promise<void> {
  const confirmed = await confirm({
    message: t('sources.confirmWithdraw', { host: source.displayHost }),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })

  if (!confirmed) return

  try {
    await catalogueApi.withdrawSource(source.id)
    toast.success(t('sources.withdrawn'))
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}
</script>

<template>
  <div class="source-manager space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h3 class="text-lg font-semibold text-text-primary">
        {{ t('anime.sources') }}
        <span v-if="episodeNumber !== undefined" class="text-text-muted font-normal">
          — {{ t('anime.episode') }} {{ episodeNumber }}
        </span>
      </h3>

      <div class="flex items-center gap-3 text-sm text-text-secondary">
        <span>{{ t('sources.activeCount', { count: activeCount }) }}</span>
        <span v-if="pendingCount > 0" class="text-yellow-300 flex items-center gap-1">
          <Clock :size="14" />
          {{ t('sources.pendingCount', { count: pendingCount }) }}
        </span>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-2">
      <Card v-for="i in 2" :key="i" variant="glass" class="p-4 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/3"></div>
      </Card>
    </div>

    <!-- Existing sources -->
    <template v-else>
      <Card
        v-for="source in sources"
        :key="source.id"
        variant="glass"
        class="p-4 flex items-center justify-between gap-4 flex-wrap"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class="font-medium text-text-primary">{{ source.displayHost }}</span>

            <span class="px-2 py-0.5 rounded-full text-xs" :class="statusTone(source.status)">
              {{ t(`sources.status.${source.status}`) }}
            </span>

            <BadgeCheck
              v-if="source.isVerified"
              :size="14"
              class="text-accent-cyan"
              :title="t('player.verified')"
            />

            <span class="text-xs text-text-muted">{{ t(`sources.kind.${source.kind}`) }}</span>
            <span v-if="source.qualityHint" class="text-xs text-text-muted">
              {{ source.qualityHint }}
            </span>
            <span v-if="source.subtitleLanguage" class="text-xs text-text-muted">
              {{ t('sources.subtitles') }}: {{ source.subtitleLanguage.toUpperCase() }}
            </span>
          </div>

          <p class="text-xs text-text-muted truncate">{{ source.canonicalUrl }}</p>

          <p v-if="source.submittedByUsername" class="text-xs text-text-muted mt-1">
            {{ source.submittedByUsername }}
            <template v-if="source.groupName"> · {{ source.groupName }}</template>
          </p>

          <!-- Why a pending or rejected source has not appeared. -->
          <p
            v-if="source.moderationNote"
            class="text-xs text-red-300 mt-1 flex items-center gap-1"
          >
            <XCircle :size="12" />
            {{ source.moderationNote }}
          </p>
        </div>

        <Button variant="ghost" size="sm" @click="withdraw(source)">
          <Trash2 :size="16" />
        </Button>
      </Card>

      <p v-if="sources.length === 0" class="text-center text-text-secondary py-6">
        {{ t('sources.none') }}
      </p>
    </template>

    <!-- Submission -->
    <SourceSubmitForm :episode-id="episodeId" @submitted="load" />
  </div>
</template>
