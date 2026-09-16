<script setup lang="ts">
/**
 * Watch Together Sessions Browser
 * Browse and join active watch together sessions
 */

import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { usePageTitle } from '@/composables/usePageTitle'
import { api } from '@/utils/api'
import type { WatchTogetherResource, Session } from '@/utils/api/resources/watchtogether'
import { Users, RefreshCw, Play, Clock, Link2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'

const router = useRouter()
const { t } = useLocale()
const toast = useToast()

usePageTitle(() => 'Watch Together Sessions')

const sessions = ref<Session[]>([])
const loading = ref(true)
const refreshing = ref(false)
const lastRefresh = ref<Date | null>(null)

const sortedSessions = computed(() => {
  return [...sessions.value].sort((a, b) => {
    // Sort by member count (descending), then by creation time (newest first)
    if (a.memberCount !== b.memberCount) {
      return b.memberCount - a.memberCount
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
})

const timeSinceRefresh = computed(() => {
  if (!lastRefresh.value) return null
  const seconds = Math.floor((Date.now() - lastRefresh.value.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
})

async function loadSessions() {
  try {
    loading.value = true
    const watchTogetherResource = await api.resource('watchtogether') as WatchTogetherResource
    const response = await watchTogetherResource.getSessions()
    sessions.value = response.sessions || []
    lastRefresh.value = new Date()
  } catch (error: any) {
    console.error('Failed to load sessions:', error)
    toast.error('Failed to load watch together sessions')
  } finally {
    loading.value = false
  }
}

async function refreshSessions() {
  try {
    refreshing.value = true
    await loadSessions()
    toast.success('Sessions refreshed')
  } catch (error) {
    // Error already handled in loadSessions
  } finally {
    refreshing.value = false
  }
}

function joinSession(session: Session) {
  // Navigate to watch page with w2t query param
  router.push({
    name: '/watch/[animeId]/[episodeId]',
    params: {
      animeId: session.animeId.toString(),
      episodeId: session.episodeId.toString()
    },
    query: {
      w2t: session.roomId
    }
  })
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

onMounted(() => {
  loadSessions()
})
</script>

<template>
  <div class="min-h-screen bg-dark-900 py-8">
    <div class="container mx-auto px-4">
      <!-- Header -->
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 class="text-4xl font-bold text-text-primary mb-2 flex items-center gap-3">
            <Users class="w-10 h-10 text-primary" />
            Watch Together Sessions
          </h1>
          <p class="text-text-secondary">Join others watching anime together in real-time</p>
        </div>

        <div class="flex items-center gap-3">
          <span v-if="lastRefresh" class="text-sm text-text-tertiary">
            Updated {{ timeSinceRefresh }}
          </span>
          <Button
            variant="glass"
            :disabled="refreshing"
            @click="refreshSessions"
          >
            <RefreshCw :class="['w-4 h-4', refreshing && 'animate-spin']" />
            Refresh
          </Button>
        </div>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card variant="glass" :hover="false" class="p-6">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
              <Users class="w-6 h-6 text-primary" />
            </div>
            <div>
              <div class="text-2xl font-bold text-text-primary">{{ sessions.length }}</div>
              <div class="text-sm text-text-secondary">Active Sessions</div>
            </div>
          </div>
        </Card>

        <Card variant="glass" :hover="false" class="p-6">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
              <Play class="w-6 h-6 text-green-500" />
            </div>
            <div>
              <div class="text-2xl font-bold text-text-primary">
                {{ sessions.reduce((sum, s) => sum + s.memberCount, 0) }}
              </div>
              <div class="text-sm text-text-secondary">Total Viewers</div>
            </div>
          </div>
        </Card>

        <Card variant="glass" :hover="false" class="p-6">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-indigo-500/20 flex items-center justify-center">
              <Clock class="w-6 h-6 text-indigo-500" />
            </div>
            <div>
              <div class="text-2xl font-bold text-text-primary">
                {{ sessions.filter(s => new Date(s.createdAt).getTime() > Date.now() - 3600000).length }}
              </div>
              <div class="text-sm text-text-secondary">Last Hour</div>
            </div>
          </div>
        </Card>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="flex justify-center items-center py-20">
        <div class="flex flex-col items-center gap-4">
          <RefreshCw class="w-12 h-12 text-primary animate-spin" />
          <p class="text-text-secondary">Loading sessions...</p>
        </div>
      </div>

      <!-- Sessions List -->
      <div v-else-if="sessions.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card
          v-for="session in sortedSessions"
          :key="session.roomId"
          variant="glass"
          class="p-6 cursor-pointer group"
          @click="joinSession(session)"
        >
          <div class="flex flex-col gap-4">
            <!-- Header -->
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-2">
                <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
                  <Users class="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div class="text-text-primary font-semibold">
                    {{ session.memberCount }} {{ session.memberCount === 1 ? 'viewer' : 'viewers' }}
                  </div>
                  <div class="text-xs text-text-tertiary">{{ formatDate(session.createdAt) }}</div>
                </div>
              </div>

              <div class="px-2 py-1 bg-green-500/20 text-green-500 text-xs font-medium rounded">
                LIVE
              </div>
            </div>

            <!-- Details -->
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2 text-sm text-text-secondary">
                <Play class="w-4 h-4" />
                <span>Anime #{{ session.animeId }} - Episode #{{ session.episodeId }}</span>
              </div>
              <div class="flex items-center gap-2 text-xs text-text-tertiary font-mono truncate">
                <Link2 class="w-3 h-3 flex-shrink-0" />
                <span class="truncate">{{ session.roomId }}</span>
              </div>
            </div>

            <!-- Join Button -->
            <Button
              variant="primary"
              size="sm"
              class="w-full transition-transform"
            >
              <Play class="w-4 h-4" />
              Join Session
            </Button>
          </div>
        </Card>
      </div>

      <!-- Empty State -->
      <div v-else class="flex flex-col items-center justify-center py-20">
        <div class="w-20 h-20 rounded-full bg-glass-light flex items-center justify-center mb-6">
          <Users class="w-10 h-10 text-text-tertiary" />
        </div>
        <h2 class="text-2xl font-semibold text-text-primary mb-2">No Active Sessions</h2>
        <p class="text-text-secondary mb-6 text-center max-w-md">
          No one is watching together right now. Start a new session and invite your friends!
        </p>
        <Button variant="primary" @click="router.push('/')">
          Browse Anime
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
