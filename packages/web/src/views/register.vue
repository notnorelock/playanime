<script setup lang="ts">
/**
 * Registration.
 *
 * The account is created by the API, which sets an HttpOnly session cookie on
 * success — nothing is stored client-side. Client-side checks here only catch
 * what can be caught before a round trip; the API validates authoritatively and
 * its field errors are rendered next to the inputs that caused them.
 */

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { useApiError } from '@/composables/useApiError'
import { useAuthStore } from '@/store/auth'
import { usePageTitle } from '@/composables/usePageTitle'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { Mail, Lock, User, UserPlus } from 'lucide-vue-next'

definePage({
  meta: {
    icon: UserPlus,
    label: 'auth.register',
    showInNav: false,
    guest: true,
    order: 99
  }
})

const router = useRouter()
const { t } = useLocale()
const { translateError, fieldErrors } = useApiError()
const authStore = useAuthStore()

usePageTitle(() => t('pageTitle.register'))

/** Mirrors `RegisterBody` in @playanime/contracts. */
const MIN_PASSWORD_LENGTH = 12
const MIN_USERNAME_LENGTH = 3

const email = ref('')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const errorMessage = ref('')
const errors = ref<Record<string, string>>({})

const passwordHint = computed(() => t('auth.passwordRequirements', { count: MIN_PASSWORD_LENGTH }))

const handleRegister = async () => {
  errorMessage.value = ''
  errors.value = {}

  if (username.value.length < MIN_USERNAME_LENGTH) {
    errors.value = { username: t('auth.usernameTooShort') }
    return
  }

  if (password.value.length < MIN_PASSWORD_LENGTH) {
    errors.value = { password: passwordHint.value }
    return
  }

  // Checked here only: the API has no "confirm" field, so this can never be a
  // server-side error.
  if (password.value !== confirmPassword.value) {
    errors.value = { confirmPassword: t('auth.passwordMismatch') }
    return
  }

  loading.value = true

  try {
    await authStore.register(email.value, username.value, password.value)
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
  <div class="register min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Logo/Brand -->
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3 text-4xl font-bold text-gradient-primary mb-3">
          <div class="w-12 h-12 rounded-lg flex items-center justify-center">
            <img src="@/assets/images/playa-logo.svg" />
          </div>
          <span v-text="t('common.appName')"></span>
        </div>
        <p class="text-text-secondary">{{ t('auth.createAccount') }}</p>
      </div>

      <!-- Register Form -->
      <div class="glass-medium rounded-2xl p-8">
        <h1 class="text-3xl font-bold text-text-primary mb-6 text-center">
          {{ t('auth.register') }}
        </h1>

        <!-- Error Message -->
        <div v-if="errorMessage" class="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/50">
          <p class="text-red-300 text-sm">{{ errorMessage }}</p>
        </div>

        <form @submit.prevent="handleRegister" class="space-y-6">
          <!-- Email -->
          <div>
            <label for="email" class="block text-sm font-medium text-text-primary mb-2">
              {{ t('auth.email') }}
            </label>
            <div class="relative">
              <Mail :size="20" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                id="email"
                v-model="email"
                type="email"
                :placeholder="t('auth.email')"
                required
                class="pl-12"
                variant="glass"
              />
            </div>
            <p v-if="errors['email']" class="mt-1 text-sm text-red-300">{{ errors['email'] }}</p>
          </div>

          <!-- Username -->
          <div>
            <label for="username" class="block text-sm font-medium text-text-primary mb-2">
              {{ t('auth.username') }}
            </label>
            <div class="relative">
              <User :size="20" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                id="username"
                v-model="username"
                type="text"
                :placeholder="t('auth.username')"
                required
                :minlength="MIN_USERNAME_LENGTH"
                class="pl-12"
                variant="glass"
              />
            </div>
            <p v-if="errors['username']" class="mt-1 text-sm text-red-300">{{ errors['username'] }}</p>
          </div>

          <!-- Password -->
          <div>
            <label for="password" class="block text-sm font-medium text-text-primary mb-2">
              {{ t('auth.password') }}
            </label>
            <div class="relative">
              <Lock :size="20" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                id="password"
                v-model="password"
                type="password"
                :placeholder="t('auth.password')"
                required
                :minlength="MIN_PASSWORD_LENGTH"
                class="pl-12"
                variant="glass"
              />
            </div>
            <p v-if="errors['password']" class="mt-1 text-sm text-red-300">{{ errors['password'] }}</p>
            <p v-else class="mt-1 text-xs text-text-muted">{{ passwordHint }}</p>
          </div>

          <!-- Confirm Password -->
          <div>
            <label for="confirm-password" class="block text-sm font-medium text-text-primary mb-2">
              {{ t('auth.confirmPassword') }}
            </label>
            <div class="relative">
              <Lock :size="20" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                id="confirm-password"
                v-model="confirmPassword"
                type="password"
                :placeholder="t('auth.confirmPassword')"
                required
                :minlength="MIN_PASSWORD_LENGTH"
                class="pl-12"
                variant="glass"
              />
            </div>
            <p v-if="errors['confirmPassword']" class="mt-1 text-sm text-red-300">
              {{ errors['confirmPassword'] }}
            </p>
          </div>

          <!-- Submit Button -->
          <Button
            type="submit"
            variant="primary"
            size="lg"
            :disabled="loading"
            class="w-full"
          >
            <UserPlus :size="20" class="mr-2" />
            {{ loading ? t('common.loading') : t('auth.register') }}
          </Button>
        </form>

        <!-- Login Link -->
        <div class="mt-6 text-center">
          <p class="text-text-secondary text-sm">
            {{ t('auth.haveAccount') }}
            <router-link
              to="/login"
              class="text-primary hover:text-primary-hover font-semibold transition-colors"
            >
              {{ t('auth.login') }}
            </router-link>
          </p>
        </div>
      </div>

      <!-- Back to Home -->
      <div class="mt-6 text-center">
        <router-link
          to="/"
          class="text-text-secondary hover:text-primary transition-colors text-sm"
        >
          ← {{ t('common.backToHome') }}
        </router-link>
      </div>
    </div>
  </div>
</template>