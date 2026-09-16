<script setup lang="ts">
/**
 * ProfileHeader
 * Avatar, name, bio and the follow control.
 */

import { computed } from 'vue'
import { useLocale } from '@/composables/useLocale'
import type { PublicProfile } from '@playanime/contracts'
import Button from '@/components/ui/Button.vue'

interface Props {
  profile: PublicProfile | null
  loading?: boolean
  /** Hides the follow control on the viewer's own profile. */
  isOwnProfile?: boolean
  followPending?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  isOwnProfile: false,
  followPending: false
})

const emit = defineEmits<{
  toggleFollow: []
}>()

const { t, locale } = useLocale()

const displayName = computed(() => props.profile?.displayName ?? props.profile?.username ?? '')

const avatarInitial = computed(() => props.profile?.username[0]?.toUpperCase() ?? 'U')

const joinDate = computed(() => {
  if (props.profile === null) return ''
  return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(
    new Date(props.profile.createdAt)
  )
})
</script>

<template>
  <div class="profile-header glass-medium rounded-xl p-6">
    <!-- Loading State -->
    <div v-if="loading || profile === null" class="animate-pulse">
      <div class="flex items-start gap-6">
        <div class="w-24 h-24 bg-white/10 rounded-full"></div>
        <div class="flex-1 space-y-3">
          <div class="h-8 bg-white/10 rounded w-48"></div>
          <div class="h-4 bg-white/10 rounded w-32"></div>
          <div class="h-3 bg-white/10 rounded w-64"></div>
        </div>
      </div>
    </div>

    <!-- Profile Content -->
    <div v-else class="flex flex-col sm:flex-row items-start gap-6">
      <!-- Avatar -->
      <div class="shrink-0">
        <img
          v-if="profile.avatar"
          :src="profile.avatar"
          :alt="profile.username"
          class="w-24 h-24 rounded-full object-cover"
        />
        <div
          v-else
          class="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center text-white text-3xl font-bold"
        >
          {{ avatarInitial }}
        </div>
      </div>

      <!-- Info -->
      <div class="flex-1 min-w-0">
        <h1 class="text-3xl font-bold text-text-primary mb-1">
          {{ displayName }}
        </h1>

        <p v-if="profile.displayName" class="text-text-muted mb-2">
          @{{ profile.username }}
          <span v-if="profile.pronouns" class="text-text-muted">· {{ profile.pronouns }}</span>
        </p>
        <p v-else-if="profile.pronouns" class="text-text-muted mb-2">{{ profile.pronouns }}</p>

        <p class="text-sm text-text-secondary mb-3">
          {{ t('profile.joined', { date: joinDate }) }}
        </p>

        <p v-if="profile.bio" class="text-text-primary whitespace-pre-wrap">
          {{ profile.bio }}
        </p>
      </div>

      <!-- Follow -->
      <Button
        v-if="!isOwnProfile"
        :variant="profile.isFollowedByViewer ? 'glass' : 'primary'"
        :disabled="followPending"
        @click="emit('toggleFollow')"
      >
        {{ profile.isFollowedByViewer ? t('profile.unfollow') : t('profile.follow') }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
.profile-header {
  @apply w-full;
}
</style>
