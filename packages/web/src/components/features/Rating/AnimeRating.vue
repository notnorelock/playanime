<script setup lang="ts">
/**
 * Title rating.
 *
 * 10 stars, matching the API's own 1–10 scale one-to-one — clicking the
 * seventh star writes exactly `score: 7`, no doubling or rounding involved.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Star } from 'lucide-vue-next'
import { AbortError, engagementApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Card from '@/components/ui/Card.vue'

interface Props {
  animeId: string
  /** Server-computed aggregate, out of 10 — same scale as `AnimeCardModel.rating` and the API's own `score`. */
  averageScore: number | null
  ratingCount: number
}

const props = defineProps<Props>()

const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

const viewerScore = ref<number | null>(null)
const loading = ref(true)
const submitting = ref(false)
const hoveredStar = ref<number | null>(null)

let controller: AbortController | null = null

const STARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

const canRate = computed(() => authStore.isAuthenticated)

/** What the stars render: the hovered value while hovering, else the viewer's own. */
const displayedScore = computed(() => hoveredStar.value ?? viewerScore.value ?? 0)

async function load(): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true

  try {
    const rating = await engagementApi.getRating(props.animeId, request.signal)
    viewerScore.value = rating?.score ?? null
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return
    viewerScore.value = null
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

onMounted(load)

watch(() => props.animeId, load)

onUnmounted(() => {
  controller?.abort()
})

async function rate(star: number): Promise<void> {
  if (!canRate.value) {
    toast.error(t('errors.unauthorized'))
    return
  }

  if (submitting.value) return
  submitting.value = true

  try {
    if (viewerScore.value === star) {
      await engagementApi.removeRating(props.animeId)
      viewerScore.value = null
    } else {
      const rating = await engagementApi.saveRating(props.animeId, { score: star })
      viewerScore.value = rating.score
    }
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

/** Full or empty for the star at this position — a click always writes a whole 1–10 score, so there is no half-star case to render. */
function starState(position: number): 'full' | 'empty' {
  return displayedScore.value >= position ? 'full' : 'empty'
}
</script>

<template>
  <Card variant="glass">
    <div v-if="loading" class="animate-pulse space-y-3">
      <div class="h-4 bg-white/10 rounded w-1/4"></div>
      <div class="h-8 bg-white/10 rounded w-1/2"></div>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 class="text-lg font-semibold text-text-primary">{{ t('rating.rateTitle') }}</h3>

        <div v-if="averageScore !== null" class="flex items-center gap-2">
          <Star :size="18" class="fill-primary text-primary" />
          <span class="text-text-primary font-semibold">{{ averageScore.toFixed(1) }}</span>
          <span class="text-text-muted text-sm">({{ ratingCount }})</span>
        </div>
        <span v-else class="text-sm text-text-muted">{{ t('rating.noRatings') }}</span>
      </div>

      <div class="flex items-center gap-0.5 flex-wrap" @mouseleave="hoveredStar = null">
        <button
          v-for="star in STARS"
          :key="star"
          type="button"
          class="p-0.5 transition-transform hover:scale-110 disabled:cursor-not-allowed"
          :disabled="submitting || !canRate"
          :title="`${String(star)}/10`"
          @mouseenter="hoveredStar = star"
          @click="rate(star)"
        >
          <Star
            :size="20"
            :class="
              starState(star) === 'full' ? 'fill-primary text-primary' : 'text-text-muted opacity-40'
            "
          />
        </button>

        <span v-if="displayedScore > 0" class="ml-2 text-sm text-text-secondary">
          {{ displayedScore }}/10
        </span>
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
