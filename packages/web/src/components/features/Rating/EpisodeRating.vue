<script setup lang="ts">
/**
 * Episode rating and reactions.
 *
 * Scored 1–10, matching the API. The previous widget used a 5-star input, which
 * would have meant halving on write and doubling on read — a lossy round trip
 * that makes 7/10 unrepresentable.
 *
 * Reactions are tracked separately from the score, so reacting is not rating.
 * Every write returns the refreshed summary, so the displayed average is always
 * the server's, never one recomputed here.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Star } from 'lucide-vue-next'
import { REACTION_KINDS, type EpisodeRatingSummary, type ReactionKind } from '@playanime/contracts'
import { AbortError, engagementApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Card from '@/components/ui/Card.vue'

interface Props {
  episodeId: string
}

const props = defineProps<Props>()

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const summary = ref<EpisodeRatingSummary | null>(null)
const loading = ref(true)
const submitting = ref(false)
const hovered = ref<number | null>(null)

let controller: AbortController | null = null

/** The 1–10 scale the API stores. */
const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

/** Emoji per reaction kind. Presentation only; the API stores the kind. */
const REACTION_EMOJI: Readonly<Record<ReactionKind, string>> = {
  love: '❤️',
  fire: '🔥',
  cry: '😢',
  laugh: '😂',
  shock: '😮',
  think: '🤔'
}

const canRate = computed(() => authStore.isAuthenticated)

/** What the stars show: the hovered value while hovering, else the viewer's. */
const displayedScore = computed(() => hovered.value ?? summary.value?.viewerScore ?? 0)

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    summary.value = await engagementApi.episodeRating(props.episodeId, request.signal)
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    summary.value = null
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

async function rate(score: number): Promise<void> {
  if (!canRate.value) {
    toast.error(t('errors.unauthorized'))
    return
  }

  if (submitting.value) return
  submitting.value = true

  try {
    // Clicking the current score clears it, which is the only way to un-rate.
    summary.value =
      summary.value?.viewerScore === score
        ? await engagementApi.removeEpisodeRating(props.episodeId)
        : await engagementApi.rateEpisode(props.episodeId, { score })
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

async function react(kind: ReactionKind): Promise<void> {
  if (!canRate.value) {
    toast.error(t('errors.unauthorized'))
    return
  }

  try {
    summary.value = await engagementApi.toggleEpisodeReaction(props.episodeId, kind)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  }
}

function reactionCount(kind: ReactionKind): number {
  return summary.value?.reactions[kind] ?? 0
}

function hasReacted(kind: ReactionKind): boolean {
  return summary.value?.viewerReactions.includes(kind) ?? false
}
</script>

<template>
  <Card variant="glass">
    <div v-if="loading" class="animate-pulse space-y-3">
      <div class="h-4 bg-white/10 rounded w-1/4"></div>
      <div class="h-8 bg-white/10 rounded w-2/3"></div>
    </div>

    <template v-else-if="summary">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 class="text-lg font-semibold text-text-primary">{{ t('rating.rateEpisode') }}</h3>

        <!-- Aggregate. Absent rather than zero when nobody has rated. -->
        <div v-if="summary.averageScore !== null" class="flex items-center gap-2">
          <Star :size="18" class="fill-primary text-primary" />
          <span class="text-text-primary font-semibold">
            {{ summary.averageScore.toFixed(1) }}
          </span>
          <span class="text-text-muted text-sm">
            ({{ summary.ratingCount }})
          </span>
        </div>
        <span v-else class="text-sm text-text-muted">{{ t('rating.noRatings') }}</span>
      </div>

      <!-- 1-10 scale -->
      <div class="flex items-center gap-1 mb-6" @mouseleave="hovered = null">
        <button
          v-for="score in SCORES"
          :key="score"
          type="button"
          class="p-1 transition-transform hover:scale-110 disabled:cursor-not-allowed"
          :disabled="submitting || !canRate"
          :title="`${score}/10`"
          @mouseenter="hovered = score"
          @click="rate(score)"
        >
          <Star
            :size="22"
            :class="
              score <= displayedScore ? 'fill-primary text-primary' : 'text-text-muted opacity-40'
            "
          />
        </button>

        <span v-if="displayedScore > 0" class="ml-2 text-sm text-text-secondary">
          {{ displayedScore }}/10
        </span>
      </div>

      <!-- Reactions -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="kind in REACTION_KINDS"
          :key="kind"
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-smooth"
          :class="
            hasReacted(kind)
              ? 'bg-primary/20 text-primary'
              : 'glass-light text-text-secondary hover:glass-medium'
          "
          @click="react(kind)"
        >
          <span>{{ REACTION_EMOJI[kind] }}</span>
          <span v-if="reactionCount(kind) > 0">{{ reactionCount(kind) }}</span>
        </button>
      </div>

      <p v-if="!canRate" class="mt-4 text-sm text-text-muted">
        <router-link to="/login" class="text-primary hover:text-primary-hover">
          {{ t('auth.login') }}
        </router-link>
        — {{ t('rating.loginToRate') }}
      </p>
    </template>
  </Card>
</template>
