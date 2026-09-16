<script setup lang="ts">
/**
 * Comment composer.
 *
 * Posts to whichever scope the parent supplies — a title or an episode. Both
 * require a verified email server-side, so the form says as much up front rather
 * than letting a submit be rejected.
 */

import { computed, ref } from 'vue'
import { Send } from 'lucide-vue-next'
import { engagementApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Button from '@/components/ui/Button.vue'

interface Props {
  animeId?: string | null
  episodeId?: string | null
  parentId?: string | null
  isReply?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  animeId: null,
  episodeId: null,
  parentId: null,
  isReply: false
})

const emit = defineEmits<{
  created: []
  cancel: []
}>()

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

/** Matches `CommentCreateBody`. */
const MAX_LENGTH = 10000

const body = ref('')
const hasSpoilers = ref(false)
const submitting = ref(false)

const emailVerified = computed(() => authStore.user?.emailVerified ?? false)
const canSubmit = computed(
  () => body.value.trim().length > 0 && emailVerified.value && !submitting.value
)

async function submit(): Promise<void> {
  if (!canSubmit.value) return

  submitting.value = true

  const payload = {
    body: body.value.trim(),
    ...(props.parentId === null ? {} : { parentId: props.parentId }),
    ...(hasSpoilers.value ? { hasSpoilers: true } : {})
  }

  try {
    if (props.episodeId !== null) {
      await engagementApi.createEpisodeComment(props.episodeId, payload)
    } else if (props.animeId !== null) {
      await engagementApi.createComment(props.animeId, payload)
    } else {
      return
    }

    body.value = ''
    hasSpoilers.value = false
    toast.success(t('comments.success.created'))
    emit('created')
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="comment-form">
    <!-- Anonymous visitors see the thread but cannot post. -->
    <div v-if="!authStore.isAuthenticated" class="glass-medium rounded-lg p-4 text-center">
      <p class="text-text-secondary text-sm">
        <router-link to="/login" class="text-primary hover:text-primary-hover font-semibold">
          {{ t('auth.login') }}
        </router-link>
        — {{ t('comments.loginToComment') }}
      </p>
    </div>

    <div
      v-else-if="!emailVerified"
      class="glass-medium rounded-lg p-4 text-center text-yellow-200 text-sm"
    >
      {{ t('errors.auth.emailNotVerified') }}
    </div>

    <form v-else class="glass-medium rounded-lg p-4 space-y-3" @submit.prevent="submit">
      <textarea
        v-model="body"
        class="w-full bg-white/10 backdrop-blur-md border border-white/20 rounded-lg px-4 py-3 text-white placeholder:text-white/50 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/50"
        :rows="isReply ? 2 : 3"
        :maxlength="MAX_LENGTH"
        :placeholder="isReply ? t('comments.yourReply') : t('comments.yourComment')"
      ></textarea>

      <div class="flex items-center justify-between gap-3 flex-wrap">
        <label class="flex items-center gap-2 text-sm text-text-secondary">
          <input v-model="hasSpoilers" type="checkbox" class="accent-primary" />
          {{ t('comments.markSpoiler') }}
        </label>

        <div class="flex gap-2">
          <Button v-if="isReply" variant="ghost" size="sm" type="button" @click="emit('cancel')">
            {{ t('common.cancel') }}
          </Button>
          <Button variant="primary" size="sm" type="submit" :disabled="!canSubmit">
            <Send :size="16" />
            {{ submitting ? t('common.posting') : t('common.post') }}
          </Button>
        </div>
      </div>
    </form>
  </div>
</template>
