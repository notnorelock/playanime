/**
 * Main entry point for the application
 * Initializes and mounts the app with required plugins and configurations.
 * Uses eager imports for optimal performance and predictable loading.
 * @author norelock
 * @date Sun 2 Nov 2025
 */

import './styles/main.css'
import { createApp, defineAsyncComponent } from 'vue'
import { createPinia } from 'pinia'

/**
 * Eagerly load all modules using Vite's glob import
 * This ensures all module code is bundled together
 */
const moduleFiles = import.meta.glob<Record<string, any>>('@/modules/*.ts', { eager: true })

// Extract and merge all module exports
const modules = Object.values(moduleFiles).reduce((acc, module) => {
  return Object.assign(acc, module)
}, {}) as {
  setupLocalization: (app: any) => Promise<any>
  setupRouter: (app: any) => Promise<any>
  setupDirectives: (app: any) => void
  setupSentry: (app: any, router: any, config?: any) => void
  setupSettings: (app: any) => Promise<void>
}

const { setupLocalization, setupRouter, setupDirectives, setupSentry, setupSettings } = modules

// Create app instance with lazy-loaded root component
const app = createApp(defineAsyncComponent(() => import('./App.vue')))

/**
 * Bootstrap function - initializes and mounts the application
 *
 * Initialization order:
 * 1. Create Vue app instance
 * 2. Install Pinia store
 * 3. Setup global directives
 * 4. Setup localization (loads language from settings)
 * 5. Setup settings (apply theme, etc.)
 * 6. Setup router (async - waits for router.isReady())
 * 7. Setup Sentry error tracking
 * 8. Mount app
 * 9. Remove preloader
 */
async function bootstrap() {
  try {
    // Install Pinia state management
    app.use(createPinia())

    // Setup global directives
    setupDirectives(app)

    // Setup localization (will load language from settings)
    await setupLocalization(app)

    // Setup settings (apply theme, etc.)
    await setupSettings(app)

    // Setup router (async - waits for router.isReady())
    const router = await setupRouter(app)

    // Setup Sentry error tracking
    setupSentry(app, router)

    // Mount the app
    app.mount('#app')

    console.log('[app] Application bootstrap completed successfully')
  } catch (error) {
    console.error('[app] Failed to bootstrap application:', error)
    throw error
  }
}

// Start bootstrap when window loads
window.onload = bootstrap
