<script setup lang="ts">
/**
 * One comment.
 *
 * The body is rendered as plain text. User-generated markup is never trusted or
 * interpreted anywhere in PlayAnime, so there is no HTML rendering path here to
 * get wrong.
 *
 * `canEdit` comes from the server, which decides ownership. This component only
 * renders what that flag allows; it does not compute permission itself.
 */

import { computed, ref } from 'vue'
import { Heart, MessageSquare } from 'lucide-vue-next'
import type { Comment, CommentLikeResponse } from '@playanime/contracts'
import { engagementApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import CommentForm from './CommentForm.vue'

interface Props {
  comment: Comment
  animeId?: string | null
  episodeId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  animeId: null,
  episodeId: null
})

const emit = defineEmits<{
  changed: []
  liked: [payload: CommentLikeResponse]
}>()

const { t, locale } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()
const authStore = useAuthStore()

const isEditing = ref(false)
const editBody = ref('')
const showReply = ref(false)
const busy = ref(false)
const spoilerRevealed = ref(false)

const authorName = computed(
  () => props.comment.author.displayName ?? props.comment.author.username
)

const formattedDate = computed(() =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(props.comment.createdAt)
  )
)

const wasEdited = computed(() => props.comment.updatedAt !== props.comment.createdAt)

/** Spoiler bodies stay hidden until the reader asks for them. */
const bodyHidden = computed(() => props.comment.hasSpoilers && !spoilerRevealed.value)

function startEdit(): void {
  editBody.value = props.comment.body
  isEditing.value = true
}

async function saveEdit(): Promise<void> {
  if (editBody.value.trim().length === 0 || busy.value) return

  busy.value = true

  try {
    await engagementApi.updateComment(props.comment.id, { body: editBody.value.trim() })
    isEditing.value = false
    toast.success(t('comments.success.updated'))
    emit('changed')
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  const confirmed = await confirm({
    message: t('comments.confirmDelete'),
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })

  if (!confirmed) return

  busy.value = true

  try {
    await engagementApi.deleteComment(props.comment.id)
    toast.success(t('comments.success.deleted'))
    emit('changed')
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busy.value = false
  }
}

async function toggleLike(): Promise<void> {
  if (!authStore.isAuthenticated) {
    toast.error(t('errors.unauthorized'))
    return
  }

  try {
    emit('liked', await engagementApi.toggleLike(props.comment.id))
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}
</script>

<template>
  <div class="comment-item">
    <div
      class="glass-medium rounded-lg p-4 transition-smooth hover:glass-strong"
      :class="{ 'opacity-50': busy }"
    >
      <div class="flex items-start gap-3">
        <!-- Avatar -->
        <img
          v-if="comment.author.avatar"
          :src="comment.author.avatar"
          :alt="comment.author.username"
          class="w-10 h-10 rounded-full object-cover shrink-0"
        />
        <div
          v-else
          class="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center text-white font-semibold shrink-0"
        >
          {{ comment.author.username.charAt(0).toUpperCase() }}
        </div>

        <div class="flex-1 min-w-0">
          <!-- Header -->
          <div class="flex items-center gap-2 flex-wrap">
            <router-link
              :to="`/profile/${comment.author.username}`"
              class="font-semibold text-text-primary hover:text-primary transition-colors"
            >
              {{ authorName }}
            </router-link>

            <span class="text-sm text-text-secondary">{{ formattedDate }}</span>

            <span v-if="wasEdited" class="text-xs text-text-secondary italic">
              ({{ t('comments.edited') }})
            </span>

            <span
              v-if="comment.rating !== null"
              class="px-2 py-0.5 rounded-full text-xs bg-primary/20 text-primary"
            >
              {{ comment.rating }}/10
            </span>
          </div>

          <!-- Body -->
          <template v-if="!isEditing">
            <button
              v-if="bodyHidden"
              type="button"
              class="mt-2 w-full text-left px-3 py-2 rounded-lg glass-light text-text-muted text-sm hover:glass-medium transition-smooth"
              @click="spoilerRevealed = true"
            >
              {{ t('comments.spoiler') }} — {{ t('common.view') }}
            </button>

            <p v-else class="mt-2 text-text-primary whitespace-pre-wrap break-words">
              {{ comment.body }}
            </p>
          </template>

          <!-- Edit -->
          <div v-else class="mt-2 space-y-2">
            <textarea
              v-model="editBody"
              class="w-full bg-white/10 backdrop-blur-md border border-white/20 rounded-lg px-4 py-2 text-white placeholder:text-white/50 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/50"
              rows="3"
              :placeholder="t('comments.yourComment')"
            ></textarea>
            <div class="flex gap-2">
              <button
                class="px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50"
                :disabled="busy || editBody.trim().length === 0"
                @click="saveEdit"
              >
                {{ busy ? t('common.saving') : t('common.save') }}
              </button>
              <button
                class="px-3 py-1.5 bg-dark-700 text-text-primary rounded-lg hover:bg-dark-600"
                @click="isEditing = false"
              >
                {{ t('common.cancel') }}
              </button>
            </div>
          </div>

          <!-- Actions -->
          <div v-if="!isEditing" class="mt-3 flex items-center gap-4 text-sm text-text-secondary">
            <button
              class="flex items-center gap-1 hover:text-primary transition-smooth"
              :class="{ 'text-primary': comment.isLikedByViewer }"
              @click="toggleLike"
            >
              <Heart :size="16" :class="{ 'fill-primary': comment.isLikedByViewer }" />
              <span v-if="comment.likeCount > 0">{{ comment.likeCount }}</span>
            </button>

            <button
              v-if="authStore.isAuthenticated"
              class="flex items-center gap-1 hover:text-primary transition-smooth"
              @click="showReply = !showReply"
            >
              <MessageSquare :size="16" />
              {{ showReply ? t('common.cancel') : t('comments.reply') }}
              <span v-if="comment.replyCount > 0">({{ comment.replyCount }})</span>
            </button>

            <template v-if="comment.canEdit">
              <button class="hover:text-primary transition-smooth" @click="startEdit">
                {{ t('comments.edit') }}
              </button>
              <button
                class="hover:text-red-400 transition-smooth"
                :disabled="busy"
                @click="remove"
              >
                {{ t('comments.delete') }}
              </button>
            </template>
          </div>
        </div>
      </div>

      <!-- Reply form -->
      <div v-if="showReply" class="mt-4 ml-13">
        <CommentForm
          :anime-id="animeId"
          :episode-id="episodeId"
          :parent-id="comment.id"
          is-reply
          @created="
            () => {
              showReply = false
              emit('changed')
            }
          "
          @cancel="showReply = false"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.comment-item {
  @apply w-full;
}
</style>
