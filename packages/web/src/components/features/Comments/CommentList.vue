<script setup lang="ts">
/**
 * Comment thread.
 *
 * Scoped to either a title or an episode — the API keys comments on one or the
 * other, and this component takes whichever the page has.
 *
 * Cursor-paginated like every other listing. `isLikedByViewer` arrives with each
 * comment (resolved server-side in one query for the page), so the thread never
 * asks per comment whether the viewer liked it.
 */

import { computed, onUnmounted, ref, watch } from 'vue'
import type { Comment } from '@playanime/contracts'
import { AbortError, engagementApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import CommentItem from './CommentItem.vue'
import CommentForm from './CommentForm.vue'
import Button from '@/components/ui/Button.vue'

interface Props {
  /** Exactly one of these identifies the thread. */
  animeId?: string | null
  episodeId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  animeId: null,
  episodeId: null
})

const { t } = useLocale()
const { translateError } = useApiError()

const comments = ref<Comment[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const error = ref<string | null>(null)

let cursor: string | null = null
let controller: AbortController | null = null

const hasTarget = computed(() => props.animeId !== null || props.episodeId !== null)

async function load(append = false): Promise<void> {
  if (!hasTarget.value) return

  controller?.abort()
  const request = new AbortController()
  controller = request

  if (append) loadingMore.value = true
  else {
    loading.value = true
    cursor = null
  }
  error.value = null

  const query = { limit: 20, ...(append && cursor !== null ? { cursor } : {}) }

  try {
    const page =
      props.episodeId !== null
        ? await engagementApi.episodeComments(props.episodeId, query, request.signal)
        : await engagementApi.comments(props.animeId ?? '', query, request.signal)

    if (request.signal.aborted) return

    comments.value = append ? [...comments.value, ...page.items] : page.items
    cursor = page.nextCursor
    hasMore.value = page.hasMore
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    if (!append) comments.value = []
    error.value = translateError(cause)
  } finally {
    if (controller === request) {
      loading.value = false
      loadingMore.value = false
      controller = null
    }
  }
}

watch(
  () => [props.animeId, props.episodeId],
  () => {
    void load()
  },
  { immediate: true }
)

onUnmounted(() => {
  controller?.abort()
})

/** A new comment or a deletion re-reads the first page rather than splicing. */
function refresh(): void {
  void load()
}

/** Applied in place: a like must not cost a full thread reload. */
function onLiked(updated: { commentId: string; likeCount: number; isLikedByViewer: boolean }): void {
  comments.value = comments.value.map((comment) =>
    comment.id === updated.commentId
      ? { ...comment, likeCount: updated.likeCount, isLikedByViewer: updated.isLikedByViewer }
      : comment
  )
}
</script>

<template>
  <div class="comment-list space-y-6">
    <div class="flex items-center justify-between">
      <h3 class="text-xl font-semibold text-text-primary">
        {{ t('comments.title') }}
      </h3>
    </div>

    <CommentForm :anime-id="animeId" :episode-id="episodeId" @created="refresh" />

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 3" :key="i" class="glass-medium rounded-lg p-4 animate-pulse">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 bg-white/10 rounded-full"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 bg-white/10 rounded w-1/4"></div>
            <div class="h-3 bg-white/10 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="glass-medium rounded-lg p-4 text-center text-red-400">
      <p>{{ error }}</p>
      <button class="mt-2 text-primary hover:text-primary-hover underline" @click="load()">
        {{ t('common.retry') }}
      </button>
    </div>

    <!-- Empty -->
    <div v-else-if="comments.length === 0" class="glass-medium rounded-lg p-8 text-center">
      <p class="text-text-secondary">{{ t('comments.empty') }}</p>
    </div>

    <!-- Comments -->
    <div v-else class="space-y-4">
      <CommentItem
        v-for="comment in comments"
        :key="comment.id"
        :comment="comment"
        :anime-id="animeId"
        :episode-id="episodeId"
        @changed="refresh"
        @liked="onLiked"
      />

      <div v-if="hasMore" class="text-center pt-2">
        <Button variant="glass" :disabled="loadingMore" @click="load(true)">
          {{ loadingMore ? t('common.loading') : t('common.loadMore') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/main.css";
.comment-list {
  @apply w-full;
}
</style>
