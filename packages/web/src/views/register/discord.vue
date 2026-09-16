<script setup lang="ts">
/**
 * Finishes a Discord signup.
 *
 * Reached only via the redirect from `GET /auth/discord/callback` when no
 * account is linked to that Discord identity yet — the query string carries a
 * short-lived, single-use token identifying the pending signup in Redis, plus
 * Discord's own username and email as starting suggestions the visitor can
 * still edit before the account is actually created.
 */

import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { UserPlus } from 'lucide-vue-next'
import { useLocale } from '@/composables/useLocale'
import { useApiError } from '@/composables/useApiError'
import { useAuthStore } from '@/store/auth'
import { usePageTitle } from '@/composables/usePageTitle'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Card from '@/components/ui/Card.vue'
import DiscordIcon from '@/components/icons/DiscordIcon.vue'

definePage({
  meta: {
    showInNav: false,
    guest: true
  }
})

const route = useRoute()
const router = useRouter()
const { t } = useLocale()
const { translateError, fieldErrors } = useApiError()
const authStore = useAuthStore()

usePageTitle(() => t('auth.discordFinishSignup'))

const MIN_USERNAME_LENGTH = 3

const token = computed(() => {
  const value = route.query['token']
  return typeof value === 'string' ? value : ''
})

const username = ref(typeof route.query['username'] === 'string' ? route.query['username'] : '')
const email = ref(typeof route.query['email'] === 'string' ? route.query['email'] : '')
const loading = ref(false)
const errorMessage = ref('')
const errors = ref<Record<string, string>>({})

// A token-less arrival did not come from the callback redirect at all.
const missingToken = token.value.length === 0

async function handleSubmit(): Promise<void> {
  errorMessage.value = ''
  errors.value = {}

  if (username.value.trim().length < MIN_USERNAME_LENGTH) {
    errors.value = { username: t('auth.usernameTooShort') }
    return
  }

  loading.value = true

  try {
    await authStore.completeDiscordSignup({
      pendingSignupToken: token.value,
      username: username.value.trim(),
      email: email.value.trim()
    })
    await router.push({ name: '/' })
  } catch (cause: unknown) {
    errors.value = fieldErrors(cause)
    errorMessage.value = translateError(cause)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="discord-signup min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3 text-4xl font-bold text-gradient-primary mb-3">
          <div class="w-12 h-12 rounded-lg flex items-center justify-center">
            <img src="@/assets/images/playa-logo.svg" />
          </div>
          <span v-text="t('common.appName')"></span>
        </div>
      </div>

      <Card variant="glass" class="p-8">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center shrink-0">
            <DiscordIcon :size="20" class="text-white" />
          </div>
          <h1 class="text-2xl font-bold text-text-primary">{{ t('auth.discordFinishSignup') }}</h1>
        </div>

        <p v-if="missingToken" class="text-text-secondary text-sm mb-6">
          {{ t('auth.discordSignupExpired') }}
        </p>

        <template v-else>
          <p class="text-text-secondary text-sm mb-6">
            {{ t('auth.discordFinishSignupHint') }}
          </p>

          <div v-if="errorMessage" class="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/50">
            <p class="text-red-300 text-sm">{{ errorMessage }}</p>
          </div>

          <form @submit.prevent="handleSubmit" class="space-y-6">
            <div>
              <label for="username" class="block text-sm font-medium text-text-primary mb-2">
                {{ t('auth.username') }}
              </label>
              <Input
                id="username"
                v-model="username"
                type="text"
                :placeholder="t('auth.username')"
                required
                :minlength="MIN_USERNAME_LENGTH"
                variant="glass"
              />
              <p v-if="errors['username']" class="mt-1 text-sm text-red-300">{{ errors['username'] }}</p>
            </div>

            <div>
              <label for="email" class="block text-sm font-medium text-text-primary mb-2">
                {{ t('auth.email') }}
              </label>
              <Input
                id="email"
                v-model="email"
                type="email"
                :placeholder="t('auth.email')"
                required
                variant="glass"
              />
              <p v-if="errors['email']" class="mt-1 text-sm text-red-300">{{ errors['email'] }}</p>
            </div>

            <Button type="submit" variant="primary" size="lg" :disabled="loading" class="w-full">
              <UserPlus :size="20" class="mr-2" />
              {{ loading ? t('common.loading') : t('auth.createAccount') }}
            </Button>
          </form>
        </template>

        <div class="mt-6 text-center">
          <router-link to="/login" class="text-primary hover:text-primary-hover text-sm font-semibold">
            {{ t('auth.login') }}
          </router-link>
        </div>
      </Card>
    </div>
  </div>
</template>
