<script setup lang="ts">
/**
 * The signed-in user's own warning/sanction history.
 *
 * Read-only, self-scoped (`GET /profiles/me/sanctions`) — a user only ever
 * sees their own rows here, never another user's. Full transparency: the
 * issuing and lifting moderator's username is shown, not hidden.
 */

import { onMounted, onUnmounted, ref } from 'vue'
import type { MySanction } from '@playanime/contracts'
import { AbortError, profilesApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import Card from '@/components/ui/Card.vue'

const { t, locale } = useLocale()
const { translateError } = useApiError()
const toast = useToast()

const sanctions = ref<MySanction[]>([])
const loading = ref(true)
let controller: AbortController | null = null

function kindLabel(kind: string): string {
  const key = `profile.warnings.kinds.${kind}`
  const label = t(key)
  return label === key ? kind : label
}

function statusLabel(sanction: MySanction): string {
  if (sanction.liftedAt !== null) return t('profile.warnings.status.lifted')
  if (sanction.isActive) return t('profile.warnings.status.active')
  return t('profile.warnings.status.expired')
}

function statusClass(sanction: MySanction): string {
  if (sanction.liftedAt !== null) return 'bg-white/10 text-text-muted'
  if (sanction.isActive) return 'bg-red-500/20 text-red-300'
  return 'bg-white/10 text-text-muted'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(value))
}

onMounted(async () => {
  const request = new AbortController()
  controller = request

  try {
    const response = await profilesApi.mySanctions(request.signal)
    sanctions.value = response.sanctions
  } catch (cause: unknown) {
    if (!AbortError.is(cause)) toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  controller?.abort()
})
</script>

<template>
  <Card variant="glass">
    <h2 class="text-2xl font-semibold text-text-primary mb-4">{{ t('profile.warnings.title') }}</h2>

    <div v-if="loading" class="space-y-2">
      <div class="h-16 rounded-lg bg-white/10 animate-pulse" />
      <div class="h-16 rounded-lg bg-white/10 animate-pulse" />
    </div>

    <p v-else-if="sanctions.length === 0" class="text-text-muted text-sm">
      {{ t('profile.warnings.empty') }}
    </p>

    <div v-else class="space-y-3">
      <div
        v-for="sanction in sanctions"
        :key="sanction.id"
        class="glass-light rounded-lg p-4"
      >
        <div class="flex items-center justify-between gap-4 mb-2">
          <span class="font-semibold text-text-primary">{{ kindLabel(sanction.kind) }}</span>
          <span
            class="px-2 py-0.5 rounded-md text-xs font-semibold shrink-0"
            :class="statusClass(sanction)"
          >
            {{ statusLabel(sanction) }}
          </span>
        </div>

        <p class="text-text-secondary text-sm mb-2">
          {{ t('profile.warnings.reason', { reason: sanction.reason }) }}
        </p>

        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          <span>
            {{
              sanction.issuedByUsername
                ? t('profile.warnings.issuedBy', { username: sanction.issuedByUsername })
                : t('profile.warnings.issuedBySystem')
            }}
          </span>
          <span>
            {{
              sanction.expiresAt
                ? t('profile.warnings.expiresOn', { date: formatDate(sanction.expiresAt) })
                : t('profile.warnings.permanent')
            }}
          </span>
          <span v-if="sanction.liftedAt && sanction.liftedByUsername">
            {{ t('profile.warnings.liftedBy', { username: sanction.liftedByUsername }) }}
          </span>
        </div>
      </div>
    </div>
  </Card>
</template>
