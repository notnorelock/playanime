<script setup lang="ts">
/**
 * Active sessions, shown on the security settings screen.
 *
 * A session is not a device: one device can hold several live sessions (a
 * remembered-device 2FA cookie renewed over weeks), and this list is scoped
 * to sessions, not devices — `DeviceCard` is the device-level view next to
 * this one. `isCurrent` is computed server-side against the session the
 * request itself carried, never derived client-side.
 */

import { onMounted, ref } from 'vue'
import type { SessionSummary } from '@playanime/contracts'
import { authApi } from '@/api'
import { formatRelativeTime, summarizeUserAgent } from '@/models/device'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()

const sessions = ref<SessionSummary[]>([])
const loading = ref(true)
const busyId = ref<string | null>(null)
const revokingAll = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    sessions.value = await authApi.listSessions()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function revoke(session: SessionSummary): Promise<void> {
  const confirmed = await confirm({
    message: t('security.sessions.confirmRevoke'),
    confirmText: t('security.sessions.revoke'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })
  if (!confirmed) return

  busyId.value = session.id
  try {
    await authApi.revokeSession(session.id)
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    busyId.value = null
  }
}

async function revokeAll(): Promise<void> {
  const confirmed = await confirm({
    message: t('security.sessions.confirmRevokeAll'),
    confirmText: t('security.sessions.revokeAll'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })
  if (!confirmed) return

  revokingAll.value = true
  try {
    const result = await authApi.revokeOtherSessions()
    toast.success(t('security.sessions.revokedCount', { count: result.revoked }))
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    revokingAll.value = false
  }
}
</script>

<template>
  <Card variant="glass" class="mb-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-semibold text-text-primary">{{ t('security.sessions.title') }}</h2>
      <Button
        v-if="!loading && sessions.length > 1"
        variant="ghost"
        size="sm"
        :disabled="revokingAll"
        @click="revokeAll"
      >
        {{ t('security.sessions.revokeAll') }}
      </Button>
    </div>

    <div v-if="loading" class="space-y-2">
      <div class="h-14 rounded-lg bg-white/10 animate-pulse" />
      <div class="h-14 rounded-lg bg-white/10 animate-pulse" />
    </div>

    <p v-else-if="sessions.length === 0" class="text-text-muted text-sm">
      {{ t('security.sessions.empty') }}
    </p>

    <div v-else class="space-y-2">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="flex items-center justify-between gap-4 glass-light rounded-lg p-4"
      >
        <div class="min-w-0">
          <p class="text-text-primary font-medium flex items-center gap-2 flex-wrap">
            {{ summarizeUserAgent(session.userAgent, t('security.devices.types.unknown')) }}
            <span
              v-if="session.isCurrent"
              class="px-2 py-0.5 rounded-md text-xs font-semibold bg-primary/20 text-primary shrink-0"
            >
              {{ t('security.sessions.thisSession') }}
            </span>
          </p>
          <p class="text-xs text-text-muted mt-1 truncate">
            {{ t('security.sessions.lastActive', { time: formatRelativeTime(session.lastSeenAt, locale) }) }}
            <template v-if="session.ipAddress"> · {{ session.ipAddress }}</template>
          </p>
        </div>

        <Button
          v-if="!session.isCurrent"
          variant="ghost"
          size="sm"
          class="shrink-0"
          :disabled="busyId === session.id"
          @click="revoke(session)"
        >
          {{ t('security.sessions.revoke') }}
        </Button>
      </div>
    </div>
  </Card>
</template>
