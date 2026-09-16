import type { UserRole } from '@playanime/contracts'
import type { FunctionalComponent } from 'vue'

/**
 * Route metadata.
 *
 * Declared so the navigation guard reads typed values rather than `any`: a
 * typo in `requiresRole` would otherwise be an unguarded admin route that
 * silently lets everyone through.
 */
declare module 'vue-router' {
  interface RouteMeta {
    /** Redirects to login, preserving the intended destination. */
    requiresAuth?: boolean
    /** Signed-in users are redirected away — login and register pages. */
    guest?: boolean
    /**
     * Minimum platform role. Presentation only; every privileged endpoint is
     * guarded server-side, and that is what actually decides access.
     */
    requiresRole?: UserRole
    /** Navigation presentation. */
    icon?: FunctionalComponent
    label?: string
    showInNav?: boolean
    order?: number
  }
}

export {}
