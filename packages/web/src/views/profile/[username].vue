<script setup lang="ts">
/**
 * Public profile.
 *
 * Profiles are addressed by username, which is what the API keys them on. What
 * a visitor sees is decided server-side — private library entries never reach
 * this page, so there is nothing to filter here.
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { PublicProfile } from '@playanime/contracts'
import { AbortError, ApiError, profilesApi } from '@/api'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { usePageTitle } from '@/composables/usePageTitle'
import { useAuthStore } from '@/store/auth'
import ProfileHeader from '@/components/features/Profile/ProfileHeader.vue'
import ProfileStats from '@/components/features/Profile/ProfileStats.vue'
import ProfileTabs from '@/components/features/Profile/ProfileTabs.vue'
import ProfileActivity from '@/components/features/Profile/ProfileActivity.vue'

const route = useRoute('/profile/[username]')
const { t } = useLocale()
const toast = useToast()
const authStore = useAuthStore()

const profile = ref<PublicProfile | null>(null)
const loading = ref(false)
const followPending = ref(false)
const error = ref<string | null>(null)

let controller: AbortController | null = null

const username = computed(() => route.params.username)

usePageTitle(() => profile.value?.displayName ?? profile.value?.username ?? '')

const isOwnProfile = computed(
  () => authStore.user !== null && authStore.user.username === profile.value?.username
)

async function fetchProfile(name: string): Promise<void> {
  controller?.abort()
  const request = new AbortController()
  controller = request

  loading.value = true
  error.value = null

  try {
    const result = await profilesApi.byUsername(name, request.signal)
    if (request.signal.aborted) return
    profile.value = result
  } catch (cause: unknown) {
    if (AbortError.is(cause)) return

    profile.value = null

    const isMissing = ApiError.is(cause) && cause.status === 404
    const message = isMissing ? t('profile.errors.notFound') : t('profile.errors.loadFailed')

    error.value = message
    // A missing profile is rendered in place; only a real failure gets a toast.
    if (!isMissing) toast.error(message)
  } finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

/**
 * Follows or unfollows, then refetches.
 *
 * The counts and the follow flag are computed server-side, so the profile is
 * re-read rather than adjusted locally — an optimistic decrement that drifts
 * from the server is worse than one extra request.
 */
async function toggleFollow(): Promise<void> {
  const current = profile.value
  if (current === null || followPending.value) return

  if (!authStore.isAuthenticated) {
    toast.error(t('errors.unauthorized'))
    return
  }

  followPending.value = true

  try {
    if (current.isFollowedByViewer) await profilesApi.unfollow(current.username)
    else await profilesApi.follow(current.username)

    await fetchProfile(current.username)
  } catch {
    toast.error(t('errors.unknown'))
  } finally {
    followPending.value = false
  }
}

onMounted(() => {
  void fetchProfile(username.value)
})

watch(username, (name) => {
  if (name) void fetchProfile(name)
})

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <div class="profile-page container mx-auto px-4 py-8 max-w-6xl">
    <!-- Error State -->
    <div v-if="error && !loading" class="glass-medium rounded-lg p-8 text-center">
      <p class="text-red-400 text-lg mb-4">{{ error }}</p>
      <router-link to="/" class="text-primary hover:text-primary-hover underline">
        {{ t('common.goHome') }}
      </router-link>
    </div>

    <!-- Profile Content -->
    <div v-else class="space-y-6">
      <ProfileHeader
        :profile="profile"
        :loading="loading"
        :is-own-profile="isOwnProfile"
        :follow-pending="followPending"
        @toggle-follow="toggleFollow"
      />

      <ProfileStats :profile="profile" :loading="loading" />

      <ProfileTabs :tabs="['activity']" v-slot="{ activeTab }">
        <ProfileActivity v-if="activeTab === 'activity' && profile" :username="profile.username" />
      </ProfileTabs>
    </div>
  </div>
</template>

<style scoped>
@reference "@/styles/main.css";

.profile-page {
  @apply w-full min-h-screen;
}
</style>
