<script setup lang="ts">
/**
 * The signed-in viewer's own profile.
 *
 * Account details come from the session, and the counters come from
 * `/profiles/me`. The previous version rendered four statistics hardcoded to
 * zero — those are gone: a number the backend does not compute has no business
 * being displayed.
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Calendar, LogOut, Mail, Shield, User } from 'lucide-vue-next'
import type { PublicProfile } from '@playanime/contracts'
import { AbortError, profilesApi } from '@/api'
import { useLocale } from '@/composables/useLocale'
import { useAuthStore } from '@/store/auth'
import { usePageTitle } from '@/composables/usePageTitle'
import Button from '@/components/ui/Button.vue'
import LinkedAccounts from '@/components/features/LinkedAccounts.vue'
import TwoFactorSettings from '@/components/features/TwoFactorSettings.vue'
import SessionsList from '@/components/features/SessionsList.vue'
import DeviceCard from '@/components/features/DeviceCard.vue'
import SecurityEventLog from '@/components/features/SecurityEventLog.vue'
import ProfileEditForm from '@/components/features/Profile/ProfileEditForm.vue'
import ProfileStats from '@/components/features/Profile/ProfileStats.vue'
import ProfileTabs from '@/components/features/Profile/ProfileTabs.vue'
import ProfileLibrary from '@/components/features/Profile/ProfileLibrary.vue'
import ProfileActivity from '@/components/features/Profile/ProfileActivity.vue'

definePage({
  meta: {
    icon: User,
    label: 'nav.profile',
    showInNav: true,
    requiresAuth: true,
    order: 90
  }
})

const router = useRouter()
const { t, locale } = useLocale()
const authStore = useAuthStore()

usePageTitle(() => t('pageTitle.profile'))

const user = computed(() => authStore.user)
const profile = ref<PublicProfile | null>(null)
const loading = ref(true)

let controller: AbortController | null = null

const handleLogout = async () => {
  await authStore.logout()
  await router.push({ name: '/' })
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(value))

onMounted(async () => {
  const request = new AbortController()
  controller = request

  try {
    profile.value = await profilesApi.me(request.signal)
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) console.error('Failed to load the profile:', cause)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <div class="profile container mx-auto px-4 py-8">
    <div class="max-w-5xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <h1 class="text-4xl font-bold text-text-primary">{{ t('nav.profile') }}</h1>
        <Button variant="ghost" @click="handleLogout">
          <LogOut :size="20" class="mr-2" />
          {{ t('auth.logout') }}
        </Button>
      </div>

      <!-- Profile Card -->
      <div v-if="user" class="glass-medium rounded-2xl p-8 mb-8">
        <div class="flex items-start gap-6 mb-8">
          <img
            v-if="user.avatar"
            :src="user.avatar"
            :alt="user.username"
            class="w-24 h-24 rounded-full object-cover shrink-0"
          />
          <div
            v-else
            class="w-24 h-24 rounded-full bg-primary flex items-center justify-center text-white text-4xl font-bold shrink-0"
          >
            {{ user.username.charAt(0).toUpperCase() }}
          </div>

          <div class="flex-1">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <h2 class="text-3xl font-bold text-text-primary">
                {{ profile?.displayName ?? user.displayName ?? user.username }}
              </h2>
              <span v-if="profile?.pronouns" class="text-text-muted text-lg">{{ profile.pronouns }}</span>
            </div>
            <p class="text-text-secondary mb-4">{{ user.email }}</p>

            <p v-if="profile?.bio" class="text-text-primary whitespace-pre-wrap mb-4">
              {{ profile.bio }}
            </p>

            <div class="flex flex-wrap gap-3 mb-4">
              <span
                v-if="user.role !== 'user'"
                class="px-3 py-1 bg-primary/20 text-primary rounded-md text-sm font-semibold flex items-center gap-2"
              >
                <Shield :size="16" />
                {{ user.role }}
              </span>

              <!-- Several actions require a verified address, so its state is shown. -->
              <span
                v-if="!user.emailVerified"
                class="px-3 py-1 bg-yellow-500/20 text-yellow-300 rounded-md text-sm font-semibold"
              >
                {{ t('auth.emailNotVerified') }}
              </span>
            </div>

            <ProfileEditForm v-if="profile" :profile="profile" @updated="profile = $event" />
          </div>
        </div>

        <!-- Details Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="glass-light rounded-lg p-4">
            <div class="flex items-center gap-3 mb-2">
              <Mail :size="20" class="text-primary" />
              <span class="text-sm text-text-muted">{{ t('auth.email') }}</span>
            </div>
            <p class="text-text-primary font-medium">{{ user.email }}</p>
          </div>

          <div class="glass-light rounded-lg p-4">
            <div class="flex items-center gap-3 mb-2">
              <User :size="20" class="text-primary" />
              <span class="text-sm text-text-muted">{{ t('auth.username') }}</span>
            </div>
            <p class="text-text-primary font-medium">{{ user.username }}</p>
          </div>

          <div class="glass-light rounded-lg p-4">
            <div class="flex items-center gap-3 mb-2">
              <Calendar :size="20" class="text-primary" />
              <span class="text-sm text-text-muted">{{ t('profile.memberSince') }}</span>
            </div>
            <p class="text-text-primary font-medium">{{ formatDate(user.createdAt) }}</p>
          </div>
        </div>
      </div>

      <ProfileTabs :tabs="['account', 'security']" class="mb-8" v-slot="{ activeTab }">
        <template v-if="activeTab === 'account'">
          <LinkedAccounts />
        </template>
        <template v-else-if="activeTab === 'security'">
          <TwoFactorSettings />
          <SessionsList />
          <DeviceCard />
          <SecurityEventLog />
        </template>
      </ProfileTabs>

      <!-- Real counters, from /profiles/me -->
      <div class="mb-8">
        <ProfileStats :profile="profile" :loading="loading" />
      </div>

      <ProfileTabs :tabs="['library', 'activity']" v-slot="{ activeTab }">
        <ProfileLibrary v-if="activeTab === 'library'" />
        <ProfileActivity
          v-else-if="activeTab === 'activity' && profile"
          :username="profile.username"
        />
      </ProfileTabs>

      <!-- Quick Actions -->
      <!-- <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        <router-link to="/settings" class="glass-light hover:glass-medium rounded-xl p-6 transition-all">
          <h4 class="text-lg font-semibold text-text-primary mb-2">{{ t('nav.settings') }}</h4>
          <p class="text-sm text-text-secondary">{{ t('settings.description') }}</p>
        </router-link>
      </div> -->
    </div>
  </div>
</template>
