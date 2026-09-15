import { Elysia } from 'elysia';
import { loadEnvOrExit, shouldPrettyPrintLogs } from '@playanime/config';
import { createLogger } from '@playanime/logger';
import { mediaRoutes } from './routes/media.js';

const config = loadEnvOrExit();
const logger = createLogger({
  name: 'api',
  level: config.LOG_LEVEL,
  pretty: shouldPrettyPrintLogs(config),
});

const app = new Elysia()
  .get('/healthz', () => ({ status: 'alive' as const }))
  .use(mediaRoutes)
  .listen({
    hostname: config.API_HOST,
    port: config.API_PORT,
  });

logger.info('API listening', {
  route: `${config.API_HOST}:${String(config.API_PORT)}`,
});

export type App = typeof app;
export { app };
