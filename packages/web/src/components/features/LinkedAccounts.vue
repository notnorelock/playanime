<script setup lang="ts">
/**
 * Linked OAuth accounts, shown on the settings page.
 *
 * Connecting is a full-page redirect to `GET /auth/discord` — the API decides
 * "log in" vs. "link" from whether the caller already has a session, so this
 * page reaches it the same way the login page does, and the callback lands
 * back here with `?linked=discord` once it succeeds.
 */

import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LinkedAccountDto } from '@playanime/contracts'
import { authApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Card from '@/components/ui/Card.vue'
import Button from '@/components/ui/Button.vue'
import DiscordIcon from '@/components/icons/DiscordIcon.vue'
import { BadgeCheck } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const { confirm } = useConfirm()
const toast = useToast()
const authStore = useAuthStore()

const accounts = ref<LinkedAccountDto[]>([])
const loading = ref(true)
const unlinking = ref(false)

const discordLinked = computed(() => accounts.value.some((account) => account.provider === 'discord'))

async function load(): Promise<void> {
  loading.value = true
  try {
    accounts.value = await authApi.linkedAccounts()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()

  // Arrived back from the callback: the query param is a one-time signal,
  // not state to keep around, so it is both surfaced and cleared here.
  if (route.query['linked'] === 'discord') {
    // The store's cached user is from before linking, so it still shows no
    // avatar if this connection just backfilled one from Discord.
    await authStore.resolve(true)
    toast.success(t('auth.discordConnected'))
    void router.replace({ query: {} })
  }
})

async function disconnect(): Promise<void> {
  const confirmed = await confirm({
    message: t('auth.confirmDisconnectDiscord'),
    confirmText: t('auth.disconnectDiscord'),
    cancelText: t('common.cancel'),
    confirmVariant: 'danger'
  })
  if (!confirmed) return

  unlinking.value = true
  try {
    await authApi.unlinkAccount('discord')
    await load()
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    unlinking.value = false
  }
}
</script>

<template>
  <Card variant="glass">
    <h2 class="text-2xl font-semibold text-text-primary mb-4">{{ t('auth.linkedAccounts') }}</h2>

    <div v-if="loading" class="h-12 rounded-lg bg-white/10 animate-pulse" />

    <div v-else class="flex items-center justify-between gap-4 glass-light rounded-lg p-4">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center shrink-0">
          <DiscordIcon :size="20" class="text-white" />
        </div>
        <div>
          <p class="text-text-primary font-medium">Discord</p>
          <p v-if="discordLinked" class="text-xs text-accent-cyan flex items-center gap-1">
            <BadgeCheck :size="12" />
            {{ t('auth.discordConnected') }}
          </p>
          <p v-else class="text-xs text-text-muted">{{ t('auth.noLinkedAccounts') }}</p>
        </div>
      </div>

      <Button
        v-if="discordLinked"
        variant="ghost"
        size="sm"
        :disabled="unlinking"
        @click="disconnect"
      >
        {{ t('auth.disconnectDiscord') }}
      </Button>
      <a
        v-else
        :href="authApi.discordAuthUrl()"
        class="px-3 py-1.5 rounded-lg text-sm bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium transition-smooth"
      >
        {{ t('auth.connectDiscord') }}
      </a>
    </div>
  </Card>
</template>
