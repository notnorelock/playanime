<script setup lang="ts">
/**
 * Notification bell, opened from the sidebar (and its mobile equivalent).
 *
 * Teleported to `body`, same reasoning as `AccountFlyout.vue`: this panel
 * would otherwise nest inside the sidebar's own `glass-strong` backdrop
 * blur, which samples what's painted directly behind it — nested, it
 * blurs the sidebar's own background instead of the page behind it.
 */

import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { CheckCheck } from 'lucide-vue-next'
import type { Notification } from '@playanime/contracts'
import { useLocale } from '@/composables/useLocale'
import { useNotifications } from '@/composables/useNotifications'
import { formatRelativeTime } from '@/models/device'

interface Props {
  open: boolean
  anchor: { bottom: number; left: number }
  triggerEl?: HTMLElement | null
  /**
   * Responsive visibility classes matching the trigger button's own
   * (`hidden md:flex` for the desktop sidebar's instance, `md:hidden` for
   * the mobile nav's) — this panel is `Teleport`ed to `body`, so it is no
   * longer inside the trigger's own hidden-by-breakpoint container and
   * needs its own copy of that class. Without it, a bell left open on one
   * layout (e.g. opened on mobile, then the viewport is resized past the
   * breakpoint, or the trigger element simply no longer exists on this
   * layout) stays visibly open with no visible trigger to have caused it.
   */
  responsiveClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  triggerEl: null,
  responsiveClass: ''
})

const emit = defineEmits<{
  close: []
}>()

const router = useRouter()
const { t, locale } = useLocale()
const { recent, unreadCount, loading, load, markAllRead, markOneRead, startPolling, stopPolling } =
  useNotifications()

const style = computed(() => ({
  bottom: `${String(props.anchor.bottom)}px`,
  left: `${String(props.anchor.left)}px`
}))

function closeIfOutside(): void {
  emit('close')
}

function notificationLabel(kind: string): string {
  const key = `notifications.kinds.${kind}`
  const label = t(key)
  return label === key ? kind : label
}

async function openNotification(notification: Notification): Promise<void> {
  await markOneRead(notification)
  emit('close')
  if (notification.href !== null) void router.push(notification.href)
}

function seeAll(): void {
  emit('close')
  void router.push('/notifications')
}

onMounted(() => {
  void load()
  startPolling()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <Teleport to="body">
    <transition name="flyout-fade">
      <div
        v-if="open"
        v-click-outside="{ handler: closeIfOutside, ignore: [triggerEl] }"
        class="notification-bell fixed w-80 glass-strong rounded-xl shadow-2xl overflow-hidden origin-bottom-left z-1000"
        :class="responsiveClass"
        :style="style"
      >
        <div class="flex items-center justify-between gap-2 px-4 py-3">
          <h3 class="text-text-primary font-semibold text-sm">{{ t('notifications.title') }}</h3>
          <button
            v-if="unreadCount > 0"
            type="button"
            class="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
            @click="markAllRead"
          >
            <CheckCheck :size="14" />
            {{ t('notifications.markAllRead') }}
          </button>
        </div>

        <div class="h-px bg-white/10" />

        <div v-if="loading && recent.length === 0" class="p-4 space-y-2">
          <div class="h-12 rounded-lg bg-white/10 animate-pulse" />
          <div class="h-12 rounded-lg bg-white/10 animate-pulse" />
        </div>

        <p v-else-if="recent.length === 0" class="px-4 py-8 text-center text-text-muted text-sm">
          {{ t('notifications.empty') }}
        </p>

        <div v-else class="max-h-96 overflow-y-auto">
          <button
            v-for="notification in recent"
            :key="notification.id"
            type="button"
            class="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
            @click="openNotification(notification)"
          >
            <span
              class="w-2 h-2 rounded-full mt-1.5 shrink-0"
              :class="notification.readAt === null ? 'bg-primary' : 'bg-transparent'"
            />
            <div class="min-w-0 flex-1">
              <p class="text-xs text-text-muted mb-0.5">{{ notificationLabel(notification.kind) }}</p>
              <p class="text-text-primary text-sm font-medium truncate">{{ notification.title }}</p>
              <p class="text-text-secondary text-xs line-clamp-2 mt-0.5">{{ notification.body }}</p>
              <p class="text-text-muted text-xs mt-1">
                {{ formatRelativeTime(notification.createdAt, locale) }}
              </p>
            </div>
          </button>
        </div>

        <div class="h-px bg-white/10" />

        <button
          type="button"
          class="w-full px-4 py-2.5 text-center text-xs text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
          @click="seeAll"
        >
          {{ t('notifications.seeAll') }}
        </button>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.flyout-fade-enter-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.flyout-fade-leave-active {
  transition:
    opacity 0.12s ease-in,
    transform 0.12s ease-in;
}

.flyout-fade-enter-from,
.flyout-fade-leave-to {
  opacity: 0;
  transform: translateX(-10px) scale(0.96);
}
</style>
