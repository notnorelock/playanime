<script setup lang="ts">
/**
 * Administration — catalogue.
 *
 * Hiding a title is a soft delete: the row, its sources and every library entry
 * pointing at it survive, so a mistaken removal is reversible and a viewer's
 * list does not lose entries. Nothing here hard-deletes.
 *
 * `actualEpisodeCount` is shown next to the declared `episodeCount` because the
 * two disagreeing is the most common catalogue defect, and invisible until
 * someone compares them.
 */

import { computed, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle, Eye, EyeOff, Search } from 'lucide-vue-next'
import { RELEASE_STATUSES, type AdminSeriesDto } from '@playanime/contracts'
import { AbortError, adminApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Input from '@/components/ui/Input.vue'
import Select from '@/components/ui/Select.vue'
import Button from '@/components/ui/Button.vue'
import Modal from '@/components/ui/Modal/Modal.vue'
import Textarea from '@/components/ui/Textarea.vue'

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const items = ref<AdminSeriesDto[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(false)

const searchQuery = ref('')
const includeDeleted = ref(false)

let cursor: string | null = null
let controller: AbortController | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const visibilityOptions = computed(() => [
  { label: t('admin.dashboard.manage.anime.visibleOnly'), value: false },
  { label: t('admin.dashboard.manage.anime.includeHidden'), value: true }
])

const statusOptions = computed(() =>
  RELEASE_STATUSES.map((value) => ({ label: t(`status.${value}`), value }))
)

async function load(append = false): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  if (append) loadingMore.value = true
  else {
    loading.value = true
    cursor = null
  }

  try {
    const page = await adminApi.anime(
      {
        limit: 25,
        ...(searchQuery.value.trim().length > 0 ? { search: searchQuery.value.trim() } : {}),
        ...(includeDeleted.value ? { includeDeleted: true } : {}),
        ...(append && cursor !== null ? { cursor } : {})
      },
      request.signal
    )

    if (request.signal.aborted) return

    items.value = append ? [...items.value, ...page.items] : page.items
    cursor = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    if (!append) items.value = []
    toast.error(translateError(cause))
  } finally {
    if (controller === request) {
      loading.value = false
      loadingMore.value = false
      controller = null
    }
  }
}

watch([searchQuery, includeDeleted], () => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void load()
  }, 300)
})

void load()

onUnmounted(() => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  controller?.abort()
})

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

const target = ref<AdminSeriesDto | null>(null)
const mode = ref<'edit' | 'visibility' | null>(null)
const reason = ref('')
const editStatus = ref('')
const editIsAdult = ref(false)
const submitting = ref(false)

function openEdit(item: AdminSeriesDto): void {
  target.value = item
  mode.value = 'edit'
  editStatus.value = item.status ?? 'not_yet_released'
  editIsAdult.value = item.isAdult
  reason.value = ''
}

function openVisibility(item: AdminSeriesDto): void {
  target.value = item
  mode.value = 'visibility'
  reason.value = ''
}

function close(): void {
  target.value = null
  mode.value = null
  reason.value = ''
}

async function submit(): Promise<void> {
  const item = target.value
  if (item === null) return

  submitting.value = true

  try {
    if (mode.value === 'edit') {
      await adminApi.updateAnime(item.id, {
        status: editStatus.value as NonNullable<AdminSeriesDto['status']>,
        isAdult: editIsAdult.value
      })
      toast.success(t('admin.dashboard.manage.anime.updated'))
    } else {
      if (reason.value.trim().length === 0) return

      if (item.deletedAt === null) await adminApi.hideAnime(item.id, reason.value.trim())
      else await adminApi.restoreAnime(item.id, reason.value.trim())

      toast.success(t('admin.dashboard.manage.anime.visibilityChanged'))
    }

    close()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

/** True when the catalogue's declared count disagrees with the real rows. */
function hasCountMismatch(item: AdminSeriesDto): boolean {
  return item.episodeCount !== null && item.episodeCount !== item.actualEpisodeCount
}
</script>

<template>
  <div class="admin-anime space-y-6">
    <h2 class="text-2xl font-bold text-text-primary">
      {{ t('admin.dashboard.sections.anime') }}
    </h2>

    <!-- Filters -->
    <Card variant="glass" class="p-4">
      <div class="flex flex-col md:flex-row gap-4">
        <div class="flex-1 relative">
          <Search :size="20" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <Input
            v-model="searchQuery"
            :placeholder="t('admin.dashboard.manage.anime.search')"
            class="pl-10 w-full"
          />
        </div>
        <Select v-model="includeDeleted" :options="visibilityOptions" />
      </div>
    </Card>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 5" :key="i" variant="glass" class="p-5 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
        <div class="h-3 bg-white/10 rounded w-1/4"></div>
      </Card>
    </div>

    <!-- List -->
    <div v-else-if="items.length > 0" class="space-y-3">
      <Card
        v-for="item in items"
        :key="item.id"
        variant="glass"
        class="p-5 hover:glass-strong transition-smooth"
        :class="{ 'opacity-60': item.deletedAt !== null }"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <h4 class="font-semibold text-text-primary truncate">{{ item.title }}</h4>

              <span v-if="item.format" class="px-2 py-0.5 rounded-full text-xs bg-dark-600 text-text-muted">
                {{ t(`format.${item.format}`) }}
              </span>
              <span v-if="item.status" class="px-2 py-0.5 rounded-full text-xs bg-dark-600 text-text-muted">
                {{ t(`status.${item.status}`) }}
              </span>
              <span
                v-if="item.isAdult"
                class="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400"
              >
                18+
              </span>
              <span
                v-if="item.deletedAt"
                class="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-300"
              >
                {{ t('admin.dashboard.manage.anime.hidden') }}
              </span>
            </div>

            <div class="flex items-center gap-4 text-sm text-text-secondary flex-wrap">
              <span>{{ item.slug }}</span>
              <span v-if="item.seasonYear">{{ item.seasonYear }}</span>
              <span class="flex items-center gap-1">
                {{ t('anime.episodes') }}: {{ item.actualEpisodeCount }}
                <template v-if="item.episodeCount !== null">/ {{ item.episodeCount }}</template>
                <AlertTriangle
                  v-if="hasCountMismatch(item)"
                  :size="14"
                  class="text-yellow-400"
                  :title="t('admin.dashboard.manage.anime.countMismatch')"
                />
              </span>
              <span>{{ t('anime.sources') }}: {{ item.sourceCount }}</span>
            </div>
          </div>

          <div class="flex gap-2 shrink-0">
            <Button variant="glass" size="sm" @click="openEdit(item)">
              {{ t('common.edit') }}
            </Button>
            <Button variant="ghost" size="sm" @click="openVisibility(item)">
              <EyeOff v-if="item.deletedAt === null" :size="16" />
              <Eye v-else :size="16" />
              {{ item.deletedAt === null ? t('admin.dashboard.manage.anime.hide') : t('admin.dashboard.manage.anime.restore') }}
            </Button>
          </div>
        </div>
      </Card>

      <div v-if="hasMore" class="text-center pt-2">
        <Button variant="glass" :disabled="loadingMore" @click="load(true)">
          {{ loadingMore ? t('common.loading') : t('common.loadMore') }}
        </Button>
      </div>
    </div>

    <Card v-else variant="glass" class="p-8 text-center text-text-secondary">
      {{ t('search.noResults') }}
    </Card>

    <!-- Dialog -->
    <Modal :model-value="mode !== null" @update:model-value="close">
      <div v-if="target" class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">{{ target.title }}</h3>

        <template v-if="mode === 'edit'">
          <div>
            <label class="block text-sm text-text-secondary mb-1">{{ t('anime.status') }}</label>
            <Select v-model="editStatus" :options="statusOptions" />
          </div>

          <label class="flex items-center gap-2 text-sm text-text-secondary">
            <input v-model="editIsAdult" type="checkbox" class="accent-primary" />
            {{ t('admin.dashboard.manage.anime.markAdult') }}
          </label>
        </template>

        <template v-else>
          <p class="text-text-secondary text-sm">
            {{
              target.deletedAt === null
                ? t('admin.dashboard.manage.anime.hideWarning')
                : t('admin.dashboard.manage.anime.restoreWarning')
            }}
          </p>

          <div>
            <label class="block text-sm text-text-secondary mb-1">
              {{ t('admin.dashboard.reason') }}
            </label>
            <Textarea v-model="reason" :rows="3" />
          </div>
        </template>

        <div class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
          <Button
            variant="primary"
            :disabled="submitting || (mode === 'visibility' && reason.trim().length === 0)"
            @click="submit"
          >
            {{ submitting ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
