import { logger } from './plugins/error-handler.js';
import { start } from './server.js';

/**
 * API entrypoint.
 *
 * Kept separate from `server.ts` so the app can be imported by tests without
 * binding a port — importing a module that listens as a side effect makes
 * integration tests fight over the port and leak handles.
 *
 * `start` now does async startup work (`ensureCoreTaxonomy`) before it
 * installs its own `unhandledRejection` handler, so a failure there must be
 * caught here rather than left to fall through as a silent unhandled
 * rejection — a database the app cannot reach or write to at boot should
 * fail the container loudly, not start serving requests it can't fulfill.
 */
start().catch((error: unknown) => {
  logger.error('Fatal error during startup', error, { module: 'bootstrap' });
  process.exit(1);
});
