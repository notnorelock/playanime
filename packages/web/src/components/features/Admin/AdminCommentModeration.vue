<script setup lang="ts">
/**
 * Administration — comment moderation.
 *
 * Removal is reversible and never destructive: the row is retained with the
 * moderator, the reason and the timestamp, so a later complaint can be answered
 * and a mistaken removal undone.
 *
 * Comment bodies are rendered as plain text. User-generated markup is not
 * trusted anywhere in PlayAnime, and a moderation queue is the last place to
 * start interpreting it.
 */

import { computed, onUnmounted, ref, watch } from 'vue'
import { Flag, Search, Undo2, Trash2 } from 'lucide-vue-next'
import type { AdminCommentDto, AdminCommentQuery } from '@playanime/contracts'
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

const items = ref<AdminCommentDto[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(false)

const searchQuery = ref('')
const filter = ref<NonNullable<AdminCommentQuery['filter']>>('reported')

let cursor: string | null = null
let controller: AbortController | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const filterOptions = computed(() => [
  { label: t('admin.dashboard.manage.comments.reported'), value: 'reported' },
  { label: t('admin.dashboard.manage.comments.all'), value: 'all' },
  { label: t('admin.dashboard.manage.comments.removed'), value: 'removed' }
])

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
    const page = await adminApi.comments(
      {
        limit: 25,
        filter: filter.value,
        ...(searchQuery.value.trim().length > 0 ? { search: searchQuery.value.trim() } : {}),
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

watch([searchQuery, filter], () => {
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

const target = ref<AdminCommentDto | null>(null)
const reason = ref('')
const submitting = ref(false)

/** Restoring is undoing a decision this console recorded, so it needs no dialog. */
const isRestoring = computed(() => target.value?.removedAt !== null)

function open(item: AdminCommentDto): void {
  target.value = item
  reason.value = ''
}

function close(): void {
  target.value = null
  reason.value = ''
}

async function submit(): Promise<void> {
  const item = target.value
  if (item === null || reason.value.trim().length === 0) return

  submitting.value = true

  try {
    if (item.removedAt === null) await adminApi.removeComment(item.id, reason.value.trim())
    else await adminApi.restoreComment(item.id, reason.value.trim())

    toast.success(t('admin.dashboard.manage.comments.moderated'))
    close()
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}
</script>

<template>
  <div class="admin-comments space-y-6">
    <h2 class="text-2xl font-bold text-text-primary">
      {{ t('admin.dashboard.sections.comments') }}
    </h2>

    <!-- Filters -->
    <Card variant="glass" class="p-4">
      <div class="flex flex-col md:flex-row gap-4">
        <div class="flex-1 relative">
          <Search :size="20" class="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <Input
            v-model="searchQuery"
            :placeholder="t('admin.dashboard.manage.comments.search')"
            class="pl-10 w-full"
          />
        </div>
        <Select v-model="filter" :options="filterOptions" />
      </div>
    </Card>

    <!-- Loading -->
    <div v-if="loading" class="space-y-3">
      <Card v-for="i in 5" :key="i" variant="glass" class="p-5 animate-pulse">
        <div class="h-3 bg-white/10 rounded w-1/4 mb-3"></div>
        <div class="h-4 bg-white/10 rounded w-3/4"></div>
      </Card>
    </div>

    <!-- List -->
    <div v-else-if="items.length > 0" class="space-y-3">
      <Card
        v-for="item in items"
        :key="item.id"
        variant="glass"
        class="p-5"
        :class="{ 'opacity-60': item.removedAt !== null }"
      >
        <div class="flex items-start justify-between gap-4 mb-2 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap text-sm">
            <span class="font-semibold text-text-primary">{{ item.authorUsername }}</span>
            <span class="text-text-muted">{{ formatDate(item.createdAt) }}</span>

            <span v-if="item.animeTitle" class="text-text-secondary">
              · {{ item.animeTitle }}
            </span>

            <span
              v-if="item.openReportCount > 0"
              class="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 flex items-center gap-1"
            >
              <Flag :size="12" />
              {{ item.openReportCount }}
            </span>

            <span
              v-if="item.rating !== null"
              class="px-2 py-0.5 rounded-full text-xs bg-primary/20 text-primary"
            >
              {{ item.rating }}/10
            </span>

            <span
              v-if="item.hasSpoilers"
              class="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-300"
            >
              {{ t('comments.spoiler') }}
            </span>
          </div>

          <Button variant="ghost" size="sm" @click="open(item)">
            <Undo2 v-if="item.removedAt" :size="16" />
            <Trash2 v-else :size="16" />
            {{ item.removedAt ? t('admin.dashboard.manage.comments.restore') : t('admin.dashboard.manage.comments.remove') }}
          </Button>
        </div>

        <!-- Plain text: user markup is never interpreted. -->
        <p class="text-text-primary whitespace-pre-wrap wrap-break-word">{{ item.body }}</p>

        <p v-if="item.removalReason" class="text-xs text-red-300 mt-2">
          {{ t('admin.dashboard.reason') }}: {{ item.removalReason }}
        </p>
      </Card>

      <div v-if="hasMore" class="text-center pt-2">
        <Button variant="glass" :disabled="loadingMore" @click="load(true)">
          {{ loadingMore ? t('common.loading') : t('common.loadMore') }}
        </Button>
      </div>
    </div>

    <Card v-else variant="glass" class="p-8 text-center text-text-secondary">
      {{ t('admin.dashboard.manage.comments.empty') }}
    </Card>

    <!-- Dialog -->
    <Modal :model-value="target !== null" @update:model-value="close">
      <div v-if="target" class="space-y-4 p-2">
        <h3 class="text-xl font-semibold text-text-primary">
          {{ isRestoring ? t('admin.dashboard.manage.comments.restore') : t('admin.dashboard.manage.comments.remove') }}
        </h3>

        <blockquote class="glass-light rounded-lg p-3 text-sm text-text-secondary whitespace-pre-wrap">
          {{ target.body }}
        </blockquote>

        <div>
          <label class="block text-sm text-text-secondary mb-1">
            {{ t('admin.dashboard.reason') }}
          </label>
          <Textarea v-model="reason" :rows="3" :placeholder="t('admin.dashboard.reasonHint')" />
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
