import { Elysia } from 'elysia';
import { HealthReport, LivenessReport, type ServiceHealth } from '@playanime/contracts';
import { checkDatabaseHealth } from '@playanime/database';
import { checkRedisHealth } from '@playanime/redis';

/**
 * Health and liveness.
 *
 * Two endpoints, because orchestrators need to distinguish two questions:
 *
 * - `/live` — is the process running? Touches nothing. A failure here means
 *   restart the container.
 * - `/health` — can it actually serve traffic? Queries every dependency. A
 *   failure means take it out of the load balancer, but restarting will not
 *   help if Postgres is the thing that is down.
 *
 * Conflating them causes a database blip to trigger a restart storm across
 * every replica.
 */

const VERSION = process.env['npm_package_version'] ?? '0.1.0';
const startedAt = Date.now();

/** Slow but answering is `degraded`: worth an alert, not worth failing out. */
const DEGRADED_LATENCY_MS = 500;

function classify(healthy: boolean, latencyMs: number): ServiceHealth {
  if (!healthy) return 'unhealthy';
  return latencyMs > DEGRADED_LATENCY_MS ? 'degraded' : 'healthy';
}

/** The worst dependency state determines the overall state. */
function aggregate(statuses: readonly ServiceHealth[]): ServiceHealth {
  if (statuses.includes('unhealthy')) return 'unhealthy';
  if (statuses.includes('degraded')) return 'degraded';
  return 'healthy';
}

export const healthController = new Elysia({ prefix: '/health' })
  .get(
    '/',
    async ({ set }) => {
      // Probed concurrently: a slow database should not add to the Redis
      // timeout when a monitor is waiting on the response.
      const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);

      const databaseStatus = classify(database.healthy, database.latencyMs);
      const redisStatus = classify(redis.healthy, redis.latencyMs);
      const overall = aggregate([databaseStatus, redisStatus]);

      // 503 on unhealthy so a load balancer acts without parsing the body.
      // `degraded` stays 200: the instance can still serve requests.
      set.status = overall === 'unhealthy' ? 503 : 200;

      return {
        status: overall,
        version: VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        checkedAt: new Date().toISOString(),
        services: {
          database: {
            status: databaseStatus,
            latencyMs: database.healthy ? database.latencyMs : null,
            // The reason is deliberately coarse: a health endpoint is often
            // public, and a driver message would disclose internal topology.
            ...(database.healthy ? {} : { error: 'Database is not reachable.' }),
          },
          redis: {
            status: redisStatus,
            latencyMs: redis.healthy ? redis.latencyMs : null,
            ...(redis.healthy ? {} : { error: 'Redis is not reachable.' }),
          },
        },
      };
    },
    {
      response: HealthReport,
      detail: {
        summary: 'Dependency health',
        description:
          'Queries PostgreSQL and Redis. Returns 503 when a dependency is unreachable, 200 when healthy or degraded.',
        tags: ['health'],
      },
    },
  )
  .get(
    '/live',
    () => ({
      status: 'alive' as const,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    }),
    {
      response: LivenessReport,
      detail: {
        summary: 'Process liveness',
        description: 'Answers as long as the process can serve a request. Touches no dependency.',
        tags: ['health'],
      },
    },
  );
