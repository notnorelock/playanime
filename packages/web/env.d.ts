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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
