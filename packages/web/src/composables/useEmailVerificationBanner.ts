import { computed, ref } from 'vue'
import { useAuthStore } from '@/store/auth'

/**
 * Shared visibility state for `EmailVerificationBanner`.
 *
 * Module-level (not per-component) so `App.vue` can reserve top padding for
 * the fixed bar and the bar itself can render/dismiss using the exact same
 * boolean — a locally-scoped ref in each would let a dismissal desync the
 * two, leaving dead space once the bar closes.
 */
const dismissed = ref(false)

export function useEmailVerificationBanner() {
  const authStore = useAuthStore()

  const isVisible = computed(
    () => authStore.isAuthenticated && authStore.user?.emailVerified === false && !dismissed.value
  )

  function dismiss(): void {
    dismissed.value = true
  }

  return { isVisible, dismiss }
}
