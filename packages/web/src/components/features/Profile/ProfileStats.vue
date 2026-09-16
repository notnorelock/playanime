<script setup lang="ts">
/**
 * ProfileStats
 *
 * Shows the three counters the API actually maintains. The previous version
 * rendered six — watch time, episodes watched, comments, ratings and favourites
 * among them — which the new profile contract does not expose. Rendering them
 * would mean inventing numbers, so the tiles were removed rather than zeroed.
 */

import { useLocale } from '@/composables/useLocale'
import type { PublicProfile } from '@playanime/contracts'

interface Props {
  profile: PublicProfile | null
  loading?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false
})

const { t } = useLocale()
</script>

<template>
  <div class="profile-stats">
    <!-- Loading State -->
    <div v-if="loading || profile === null" class="grid grid-cols-3 gap-4">
      <div v-for="i in 3" :key="i" class="glass-medium rounded-lg p-4 animate-pulse">
        <div class="h-4 bg-white/10 rounded w-16 mb-2"></div>
        <div class="h-6 bg-white/10 rounded w-12"></div>
      </div>
    </div>

    <!-- Stats Content -->
    <div v-else class="grid grid-cols-3 gap-4">
      <div class="glass-medium rounded-lg p-4 hover:glass-strong transition-smooth">
        <p class="text-xs text-text-secondary mb-1">{{ t('profile.stats.completed') }}</p>
        <p class="text-2xl font-bold text-primary">{{ profile.completedCount }}</p>
      </div>

      <div class="glass-medium rounded-lg p-4 hover:glass-strong transition-smooth">
        <p class="text-xs text-text-secondary mb-1">{{ t('profile.stats.followers') }}</p>
        <p class="text-2xl font-bold text-primary">{{ profile.followerCount }}</p>
      </div>

      <div class="glass-medium rounded-lg p-4 hover:glass-strong transition-smooth">
        <p class="text-xs text-text-secondary mb-1">{{ t('profile.stats.following') }}</p>
        <p class="text-2xl font-bold text-primary">{{ profile.followingCount }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-stats {
  @apply w-full;
}
</style>
