<script setup lang="ts">
/**
 * Sign in.
 *
 * The API authenticates by email address and answers with an HttpOnly session
 * cookie — no token reaches this page, and none is stored. On success the
 * viewer returns to wherever the guard sent them from.
 */

import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { useApiError } from '@/composables/useApiError'
import { useAuthStore } from '@/store/auth'
import { usePageTitle } from '@/composables/usePageTitle'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { Mail, Lock, LogIn } from 'lucide-vue-next'

definePage({
  meta: {
    icon: LogIn,
    label: 'auth.login',
    showInNav: false,
    guest: true,
    order: 99
  }
})

const route = useRoute()
const router = useRouter()
const { t } = useLocale()
const { translateError, fieldErrors } = useApiError()
const authStore = useAuthStore()

usePageTitle(() => t('pageTitle.login'))

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const errors = ref<Record<string, string>>({})

/**
 * Where to go after signing in.
 *
 * Restricted to a path within this application: echoing an arbitrary `redirect`
 * back into `router.push` would turn the login page into an open redirect.
 */
const redirectTarget = computed(() => {
  const redirect = route.query['redirect']
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) {
    return '/'
  }
  return redirect
})

const handleLogin = async () => {
  errorMessage.value = ''
  errors.value = {}
  loading.value = true

  try {
    await authStore.login(email.value, password.value)
    await router.push(redirectTarget.value)
  } catch (cause: unknown) {
    errors.value = fieldErrors(cause)
    errorMessage.value = translateError(cause)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <!-- Logo/Brand -->
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-3 text-4xl font-bold text-gradient-primary mb-3">
          <div class="w-12 h-12 rounded-lg flex items-center justify-center">
            <img src="@/assets/images/playa-logo.svg" />
          </div>
          <span v-text="t('common.appName')"></span>
        </div>
        <p class="text-text-secondary">{{ t('auth.loginToContinue') }}</p>
      </div>

      <!-- Login Form -->
      <div class="glass-medium rounded-2xl p-8">
        <h1 class="text-3xl font-bold text-text-primary mb-6 text-center">
          {{ t('auth.login') }}
        </h1>

        <!-- Error Message -->
        <div v-if="errorMessage" class="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/50">
          <p class="text-red-300 text-sm">{{ errorMessage }}</p>
        </div>

        <form @submit.prevent="handleLogin" class="space-y-6">
          <!-- Email or Username -->
          <div>
            <label for="email" class="block text-sm font-medium text-text-primary mb-2">
              {{ t('auth.email') }}
            </label>
            <div class="relative">
              <Mail :size="20" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input id="email" v-model="email" type="email" :placeholder="t('auth.email')"
                required class="pl-12" variant="glass" autocomplete="username" />
            </div>
            <p v-if="errors['email']" class="mt-1 text-sm text-red-300">{{ errors['email'] }}</p>
          </div>

          <!-- Password -->
          <div>
            <label for="password" class="block text-sm font-medium text-text-primary mb-2">
              {{ t('auth.password') }}
            </label>
            <div class="relative">
              <Lock :size="20" class="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input id="password" v-model="password" type="password" :placeholder="t('auth.password')" required
                class="pl-12" variant="glass" autocomplete="current-password" />
            </div>
            <p v-if="errors['password']" class="mt-1 text-sm text-red-300">{{ errors['password'] }}</p>
          </div>

          <!-- Submit Button -->
          <Button type="submit" variant="primary" size="lg" :disabled="loading" class="w-full">
            <LogIn :size="20" class="mr-2" />
            {{ loading ? t('common.loading') : t('auth.login') }}
          </Button>
        </form>

        <!-- Register Link -->
        <div class="mt-6 text-center">
          <p class="text-text-secondary text-sm">
            {{ t('auth.noAccount') }}
            <router-link to="/register" class="text-primary hover:text-primary-hover font-semibold transition-colors">
              {{ t('auth.createAccount') }}
            </router-link>
          </p>
        </div>
      </div>

      <!-- Back to Home -->
      <div class="mt-6 text-center">
        <router-link to="/" class="text-text-secondary hover:text-primary transition-colors text-sm">
          ← {{ t('common.backToHome') }}
        </router-link>
      </div>
    </div>
  </div>
</template>