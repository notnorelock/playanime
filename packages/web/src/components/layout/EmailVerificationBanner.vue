<script setup lang="ts">
/**
 * Top bar nudging a signed-in, unverified user to confirm their email.
 *
 * A top bar rather than `PrivacyBanner`'s bottom slide-up, per explicit
 * request — this sits above `<main>` in `App.vue` and pushes content down
 * rather than overlaying it, so it never hides something the user is
 * reading. Dismissible for the session only (a local ref, not persisted):
 * unlike the privacy banner's permanent accept, this should keep coming
 * back until the account is actually verified, on every fresh visit.
 */

import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { AlertTriangle, X } from 'lucide-vue-next'
import { authApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useEmailVerificationBanner } from '@/composables/useEmailVerificationBanner'
import { useLocale } from '@/composables/useLocale'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const { isVisible, dismiss } = useEmailVerificationBanner()

const resending = ref(false)

function goToVerify(): void {
  void router.push({ name: '/verify-email' })
}

async function resend(): Promise<void> {
  if (resending.value) return
  resending.value = true

  try {
    const response = await authApi.resendVerification()
    toast.success(response.message)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    resending.value = false
  }
}
</script>

<template>
  <div
    v-if="isVisible"
    class="fixed top-0 left-0 right-0 z-40 bg-yellow-500/10 border-b border-yellow-500/40 backdrop-blur-lg md:ml-16"
  >
    <div class="container mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 min-w-0">
        <AlertTriangle :size="16" class="text-yellow-400 shrink-0" />
        <p class="text-sm text-yellow-100 truncate">{{ t('verifyEmail.bannerMessage') }}</p>
      </div>

      <div class="flex items-center gap-3 shrink-0">
        <button
          type="button"
          class="text-sm font-medium text-yellow-300 hover:text-yellow-200 transition-smooth"
          @click="goToVerify"
        >
          {{ t('verifyEmail.bannerVerify') }}
        </button>
        <button
          type="button"
          class="text-sm text-yellow-300/80 hover:text-yellow-200 transition-smooth disabled:opacity-50"
          :disabled="resending"
          @click="resend"
        >
          {{ t('verifyEmail.bannerResend') }}
        </button>
        <button
          type="button"
          class="p-1 text-yellow-300/60 hover:text-yellow-200 transition-smooth"
          :aria-label="t('common.dismiss')"
          @click="dismiss"
        >
          <X :size="16" />
        </button>
      </div>
    </div>
  </div>
</template>
