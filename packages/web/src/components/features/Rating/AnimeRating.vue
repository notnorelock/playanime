<script setup lang="ts">
/**
 * Title rating.
 *
 * Shown as 5 stars rather than the 1–10 scale the API stores: ten individual
 * star targets read as cluttered for a single aggregate opinion on a whole
 * title (unlike the episode widget, there are no per-episode reactions
 * competing for the same row). Nothing is lost to the mapping — each star is
 * worth 2 points and a half-star fill covers the odd scores, so clicking the
 * third star still writes a precise `score: 6`, not a rounded 3.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Star, StarHalf } from 'lucide-vue-next'
import { AbortError, engagementApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Card from '@/components/ui/Card.vue'

interface Props {
  animeId: string
  /** Server-computed aggregate, already on hand from the anime detail response. */
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

const STARS = [1, 2, 3, 4, 5] as const

const canRate = computed(() => authStore.isAuthenticated)

/** The 1–10 score behind whichever star is hovered, for the click handler. */
const hoveredScore = computed(() => (hoveredStar.value === null ? null : hoveredStar.value * 2))

/** What the stars render: the hovered value while hovering, else the viewer's own. */
const displayedScore = computed(() => hoveredScore.value ?? viewerScore.value ?? 0)

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

  const score = star * 2

  try {
    if (viewerScore.value === score) {
      await engagementApi.removeRating(props.animeId)
      viewerScore.value = null
    } else {
      const rating = await engagementApi.saveRating(props.animeId, { score })
      viewerScore.value = rating.score
    }
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

/** Full, half or empty for the star at this position, given the current score out of 5. */
function starState(position: number): 'full' | 'half' | 'empty' {
  const scoreOutOf5 = displayedScore.value / 2
  if (scoreOutOf5 >= position) return 'full'
  if (scoreOutOf5 >= position - 0.5) return 'half'
  return 'empty'
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
          <span class="text-text-primary font-semibold">{{ (averageScore / 2).toFixed(1) }}</span>
          <span class="text-text-muted text-sm">({{ ratingCount }})</span>
        </div>
        <span v-else class="text-sm text-text-muted">{{ t('rating.noRatings') }}</span>
      </div>

      <div class="flex items-center gap-1" @mouseleave="hoveredStar = null">
        <button
          v-for="star in STARS"
          :key="star"
          type="button"
          class="p-1 transition-transform hover:scale-110 disabled:cursor-not-allowed"
          :disabled="submitting || !canRate"
          :title="`${String(star * 2)}/10`"
          @mouseenter="hoveredStar = star"
          @click="rate(star)"
        >
          <StarHalf
            v-if="starState(star) === 'half'"
            :size="26"
            class="fill-primary text-primary"
          />
          <Star
            v-else
            :size="26"
            :class="
              starState(star) === 'full' ? 'fill-primary text-primary' : 'text-text-muted opacity-40'
            "
          />
        </button>

        <span v-if="displayedScore > 0" class="ml-2 text-sm text-text-secondary">
          {{ (displayedScore / 2).toFixed(1) }}/5
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
