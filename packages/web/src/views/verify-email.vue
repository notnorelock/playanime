<script setup lang="ts">
/**
 * Email verification page.
 *
 * Reached two ways: a visitor types the 6-digit code from the email
 * directly, or clicks the email's link (`?code=...`), which auto-submits
 * the same code on mount — the "lazy path" the code is deliberately also
 * carried in the link for.
 */

import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CheckCircle2, MailCheck } from 'lucide-vue-next'
import { authApi } from '@/api'
import { useApiError } from '@/composables/useApiError'
import { useLocale } from '@/composables/useLocale'
import { usePageTitle } from '@/composables/usePageTitle'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/store/auth'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'

definePage({
  meta: { requiresAuth: true }
})

const route = useRoute('/verify-email')
const router = useRouter()
const { t } = useLocale()
const { translateError } = useApiError()
const toast = useToast()
const authStore = useAuthStore()

usePageTitle(() => t('pageTitle.verifyEmail'))

const code = ref('')
const submitting = ref(false)
const verified = ref(false)
const resendCooldown = ref(0)
const resending = ref(false)

let cooldownTimer: ReturnType<typeof setInterval> | null = null

function startCooldown(seconds: number): void {
  resendCooldown.value = seconds
  if (cooldownTimer !== null) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0 && cooldownTimer !== null) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

async function submit(): Promise<void> {
  if (code.value.trim().length !== 6 || submitting.value) return

  submitting.value = true

  try {
    await authApi.verifyEmail(code.value.trim())
    verified.value = true
    await authStore.resolve(true)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    submitting.value = false
  }
}

async function resend(): Promise<void> {
  if (resendCooldown.value > 0 || resending.value) return

  resending.value = true

  try {
    const response = await authApi.resendVerification()
    toast.success(response.message)
    startCooldown(60)
  } catch (cause: unknown) {
    toast.error(translateError(cause))
  } finally {
    resending.value = false
  }
}

const alreadyVerified = computed(() => authStore.user?.emailVerified ?? false)

onMounted(() => {
  const fromLink = route.query.code
  if (typeof fromLink === 'string' && fromLink.length === 6) {
    code.value = fromLink
    void submit()
  }
})

function goHome(): void {
  void router.push({ name: '/' })
}
</script>

<template>
  <div class="verify-email-page container mx-auto px-4 py-16 max-w-md">
    <Card variant="glass" class="p-8 text-center">
      <template v-if="verified || alreadyVerified">
        <CheckCircle2 :size="48" class="text-green-400 mx-auto mb-4" />
        <h1 class="text-2xl font-bold text-text-primary mb-2">{{ t('verifyEmail.successTitle') }}</h1>
        <p class="text-text-secondary mb-6">{{ t('verifyEmail.successMessage') }}</p>
        <Button variant="primary" @click="goHome">{{ t('common.backToHome') }}</Button>
      </template>

      <template v-else>
        <MailCheck :size="48" class="text-primary mx-auto mb-4" />
        <h1 class="text-2xl font-bold text-text-primary mb-2">{{ t('verifyEmail.title') }}</h1>
        <p class="text-text-secondary mb-6">{{ t('verifyEmail.subtitle') }}</p>

        <form class="space-y-4" @submit.prevent="submit">
          <Input
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            :placeholder="t('verifyEmail.codePlaceholder')"
            class="text-center text-2xl tracking-[0.5em]"
          />

          <Button
            type="submit"
            variant="primary"
            class="w-full"
            :disabled="submitting || code.trim().length !== 6"
          >
            {{ submitting ? t('common.saving') : t('verifyEmail.submit') }}
          </Button>
        </form>

        <button
          type="button"
          class="mt-4 text-sm text-text-secondary hover:text-primary transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="resendCooldown > 0 || resending"
          @click="resend"
        >
          {{
            resendCooldown > 0
              ? t('verifyEmail.resendCooldown', { seconds: resendCooldown })
              : t('verifyEmail.resend')
          }}
        </button>
      </template>
    </Card>
  </div>
</template>
