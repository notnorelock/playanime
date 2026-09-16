<script setup lang="ts">
/**
 * Episode Navigation Component
 * Navigation controls for previous/next episodes
 */

import { useLocale } from '@/composables/useLocale'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'

interface Props {
  hasPreviousEpisode?: boolean
  hasNextEpisode?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hasPreviousEpisode: false,
  hasNextEpisode: false
})

const emit = defineEmits<{
  previous: []
  next: []
}>()

const { t } = useLocale()
</script>

<template>
  <div class="flex gap-4">
    <Button
      variant="secondary"
      size="lg"
      @click="emit('previous')"
      :disabled="!hasPreviousEpisode"
      class="flex-1"
    >
      <ChevronLeft :size="20" />
      {{ t('player.previousEpisode') }}
    </Button>

    <Button
      variant="primary"
      size="lg"
      @click="emit('next')"
      :disabled="!hasNextEpisode"
      class="flex-1"
    >
      {{ t('player.nextEpisode') }}
      <ChevronRight :size="20" />
    </Button>
  </div>
</template>
