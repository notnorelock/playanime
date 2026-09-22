import { Elysia } from 'elysia';
import { loadEnvOrExit } from '@playanime/config';
import { closeDatabase, ensureCoreTaxonomy } from '@playanime/database';
import { closeRedis } from '@playanime/redis';
import { errorHandler, logger } from './plugins/error-handler.js';
import { resyncAnilistScores, translateUntranslatedTaxonomy } from './modules/catalogue/catalogue.service.js';
import { security } from './plugins/security.js';
import { v1 } from './routes/v1.js';

/**
 * API server.
 *
 * Configuration is validated before anything else: a misconfigured deployment
 * must fail immediately and loudly rather than accept traffic and fail per
 * request.
 */
const config = loadEnvOrExit();

export const app = new Elysia({
  // Query and path parameters arrive as strings. Coercion converts them to the
  // declared type before validation, so contracts can state `Type.Integer()`
  // rather than encoding transport details as numeric-string patterns.
  normalize: true,
})
  // Order matters. Security headers and the error handler wrap everything, so a
  // failure inside a route still returns a properly-shaped, properly-headed
  // response.
  .use(security)
  .use(errorHandler)
  .use(v1)

export type App = typeof app;

/** How often `resyncAnilistScores` re-runs after its initial startup call — every 3 hours, so a score is never more than ~3 hours stale. */
const ANILIST_RESYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * Starts the listener and installs signal handlers.
 *
 * `ensureCoreTaxonomy` runs before the app accepts traffic: deploys run
 * migrations (schema) but never the dev seed script, which also inserts
 * demo anime/episodes and is never something to run against a real
 * database. A deploy that only ran migrations left the genre table
 * created but empty — every genre lookup silently returned nothing, so
 * new titles were created with no genres and AniList autofill/re-sync had
 * nothing to match against. This closes that gap without a manual step,
 * and is safe to run on every startup in every environment
 * (`onConflictDoNothing` on the slug) — a fresh database gets seeded, an
 * already-seeded one is untouched.
 *
 * `translateUntranslatedTaxonomy` and `resyncAnilistScores` both run
 * fire-and-forget, not awaited: unlike `ensureCoreTaxonomy`, a DeepL/
 * AniList outage must never delay or block the API from accepting
 * traffic — both already swallow their own failures internally, so it is
 * safe to fire them alongside startup rather than gate on them.
 * `translateUntranslatedTaxonomy` catches up a tag left untranslated by a
 * past failure; `resyncAnilistScores` refreshes every series'
 * `anilistScore` once immediately (rather than waiting up to a full
 * `ANILIST_RESYNC_INTERVAL_MS` for the first refresh after a deploy or
 * restart), then again every interval via `setInterval` below — the
 * timer is only armed after this first call is already in flight, so a
 * slow AniList response on startup never causes two resyncs to overlap.
 */
export async function start(): Promise<void> {
  await ensureCoreTaxonomy();
  void translateUntranslatedTaxonomy();
  void resyncAnilistScores();

  const anilistResyncTimer = setInterval(() => {
    void resyncAnilistScores();
  }, ANILIST_RESYNC_INTERVAL_MS);
  // Never holds the process open on its own — shutdown below still exits
  // promptly even if a resync is mid-flight when a signal arrives.
  anilistResyncTimer.unref();

  app.listen({ hostname: config.API_HOST, port: config.API_PORT });

  logger.info('API listening', {
    module: 'bootstrap',
    data: `${config.API_HOST}:${String(config.API_PORT)}`,
  } as never);

  /**
   * Graceful shutdown.
   *
   * Stops accepting connections, then closes the pools so in-flight queries can
   * finish. Without this, a rolling deploy drops requests that were mid-flight.
   */
  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down`, { module: 'bootstrap' });

    void app
      .stop()
      .then(() => Promise.all([closeDatabase(), closeRedis()]))
      .then(() => {
        logger.info('Shutdown complete', { module: 'bootstrap' });
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error('Shutdown failed', error, { module: 'bootstrap' });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  // An unhandled rejection means an async path lost its error. Logged loudly
  // rather than silently swallowed by the runtime default.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason, { module: 'bootstrap' });
  });
}
