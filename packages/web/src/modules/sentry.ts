/**
 * Sentry Module
 * Configures error tracking and performance monitoring
 * @module modules/sentry
 */

import type { App } from 'vue'
import type { Router } from 'vue-router'
import * as Sentry from '@sentry/vue'

interface SentryConfig {
  dsn: string
  environment?: string
  enableTracing?: boolean
  enableReplay?: boolean
  tracesSampleRate?: number
  replaysSessionSampleRate?: number
  replaysOnErrorSampleRate?: number
}

/**
 * Default Sentry configuration
 */
const defaultConfig: SentryConfig = {
  /*
   * Read from the environment, never hardcoded.
   *
   * A DSN committed to the repository sends every developer's local errors and
   * session replays to the production project, which both pollutes the data and
   * leaks whatever is on screen while someone works. Unset means Sentry does
   * not initialize at all, which is the right default for development.
   */
  dsn: import.meta.env.VITE_SENTRY_DSN ?? '',
  environment: import.meta.env.MODE,
  /*
   * Tracing attaches `sentry-trace` and `baggage` headers to API requests.
   * That is useful in production and pure overhead locally, so it follows the
   * same switch as the DSN.
   */
  enableTracing: true,
  enableReplay: import.meta.env.PROD,
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 0,
  replaysOnErrorSampleRate: 1.0
}

/**
 * Initializes Sentry error tracking
 */
export function setupSentry(app: App, router: Router, config: Partial<SentryConfig> = {}) {
  const finalConfig = { ...defaultConfig, ...config }

  // No DSN means telemetry is disabled entirely — the normal case in
  // development, so this is not warned about.
  if (!finalConfig.dsn) return

  /*
   * Inferred from the factories that produce them.
   *
   * `@sentry/vue` does not re-export the `Integration` type, and indexing
   * `Parameters<typeof Sentry.init>[0]` does not work either — that parameter
   * is optional, so the lookup includes `undefined`.
   */
  type SentryIntegration = ReturnType<typeof Sentry.browserTracingIntegration>

  const integrations: SentryIntegration[] = []

  // Add browser tracing integration
  if (finalConfig.enableTracing) {
    integrations.push(
      Sentry.browserTracingIntegration({ router })
    )
  }

  // Add replay integration
  if (finalConfig.enableReplay) {
    integrations.push(
      Sentry.replayIntegration()
    )
  }

  // Initialize Sentry
  Sentry.init({
    app,
    dsn: finalConfig.dsn,
    environment: finalConfig.environment,
    /*
     * No PII. Enabling this attaches IP addresses, cookies and request bodies
     * to every event — on a site where the request body can be a login form,
     * that sends credentials to a third party.
     */
    sendDefaultPii: false,
    integrations,
    tracesSampleRate: finalConfig.tracesSampleRate,
    /*
     * Restricted to our own API origin. A bare 'localhost' also matches the
     * Vite dev server and any other local service, attaching trace headers to
     * requests whose CORS policy we do not control.
     */
    tracePropagationTargets: [import.meta.env.VITE_API_URL],
    replaysSessionSampleRate: finalConfig.replaysSessionSampleRate,
    replaysOnErrorSampleRate: finalConfig.replaysOnErrorSampleRate,
    enableLogs: true,

    // Filter out common non-critical errors
    beforeSend(event) {
      // Filter out navigation errors
      if (event.exception?.values?.[0]?.value?.includes('NavigationDuplicated')) {
        return null
      }

      // Filter out chunk load errors (usually network issues)
      if (event.exception?.values?.[0]?.value?.includes('ChunkLoadError')) {
        return null
      }

      return event
    }
  })

  console.log('[sentry] Error tracking initialized')
}
