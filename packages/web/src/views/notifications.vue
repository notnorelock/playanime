<script setup lang="ts">
/**
 * Full notification history.
 *
 * Reached from the bell's "see all" link, not from the icon rail — this is
 * not a primary nav destination, so it has no `navigationConfig` entry and
 * `showInNav` is left unset.
 */

import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, CheckCheck } from 'lucide-vue-next'
import type { Notification } from '@playanime/contracts'
import { useLocale } from '@/composables/useLocale'
import { useNotifications } from '@/composables/useNotifications'
import { usePageTitle } from '@/composables/usePageTitle'
import { formatRelativeTime } from '@/models/device'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

definePage({
  meta: {
    requiresAuth: true
  }
})

const router = useRouter()
const { t, locale } = useLocale()
const { recent, unreadCount, loading, hasMore, load, loadMore, markAllRead, markOneRead } =
  useNotifications()

usePageTitle(() => t('notifications.title'))

function notificationLabel(kind: string): string {
  const key = `notifications.kinds.${kind}`
  const label = t(key)
  return label === key ? kind : label
}

async function open(notification: Notification): Promise<void> {
  await markOneRead(notification)
  if (notification.href !== null) void router.push(notification.href)
}

onMounted(() => {
  void load(true)
})
</script>

<template>
  <div class="notifications-page container mx-auto px-4 py-8 max-w-2xl">
    <div class="flex items-center justify-between gap-4 mb-8">
      <h1 class="text-4xl font-bold text-text-primary">{{ t('notifications.title') }}</h1>
      <Button v-if="unreadCount > 0" variant="ghost" size="sm" @click="markAllRead">
        <CheckCheck :size="16" class="mr-2" />
        {{ t('notifications.markAllRead') }}
      </Button>
    </div>

    <Card variant="glass" class="overflow-hidden p-0">
      <div v-if="loading && recent.length === 0" class="p-6 space-y-2">
        <div class="h-16 rounded-lg bg-white/10 animate-pulse" />
        <div class="h-16 rounded-lg bg-white/10 animate-pulse" />
        <div class="h-16 rounded-lg bg-white/10 animate-pulse" />
      </div>

      <div v-else-if="recent.length === 0" class="p-12 text-center">
        <Bell :size="40" class="mx-auto mb-3 text-text-muted" />
        <p class="text-text-muted text-sm">{{ t('notifications.empty') }}</p>
      </div>

      <div v-else>
        <button
          v-for="notification in recent"
          :key="notification.id"
          type="button"
          class="w-full text-left px-6 py-4 flex items-start gap-4 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
          @click="open(notification)"
        >
          <span
            class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
            :class="notification.readAt === null ? 'bg-primary' : 'bg-transparent'"
          />
          <div class="min-w-0 flex-1">
            <p class="text-xs text-text-muted mb-0.5">{{ notificationLabel(notification.kind) }}</p>
            <p class="text-text-primary font-medium">{{ notification.title }}</p>
            <p class="text-text-secondary text-sm mt-0.5">{{ notification.body }}</p>
            <p class="text-text-muted text-xs mt-1.5">
              {{ formatRelativeTime(notification.createdAt, locale) }}
            </p>
          </div>
        </button>

        <div v-if="hasMore" class="p-4 text-center">
          <Button variant="ghost" size="sm" :disabled="loading" @click="loadMore">
            {{ t('notifications.loadMore') }}
          </Button>
        </div>
      </div>
    </Card>
  </div>
</template>
