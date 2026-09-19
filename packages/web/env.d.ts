/// <reference types="vite/client" />

/**
 * Typed environment.
 *
 * Declared so a missing or misspelled variable is a compile error rather than
 * an `undefined` that silently becomes the string "undefined" in a URL.
 */
interface ImportMetaEnv {
  /** Origin of the PlayAnime API, without a trailing slash or version path. */
  readonly VITE_API_URL: string;
  /** Sentry DSN. Optional: telemetry is disabled when unset. */
  readonly VITE_SENTRY_DSN?: string;
  /**
   * Cloudflare Turnstile site key (public, safe to ship in the bundle — the
   * matching `TURNSTILE_SECRET_KEY` is backend-only). Required: registration
   * and the contact form both render a Turnstile widget and cannot submit
   * without one.
   */
  readonly VITE_TURNSTILE_SITE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Cloudflare's Turnstile script (`https://challenges.cloudflare.com/turnstile/v0/api.js`)
 * attaches this global once loaded. Declared here, not published by
 * Cloudflare as an npm package — see `TurnstileWidget.vue`, the only
 * consumer.
 */
interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  language?: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

interface Window {
  turnstile?: TurnstileApi;
}
