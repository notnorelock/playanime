import { cacheInvalidatePattern, namespacedKey } from '@playanime/redis';
import { createLogger } from '@playanime/logger';

/**
 * Cache invalidation for catalogue writes.
 *
 * `listAnime` caches each filter combination under a hash of its parameters, so
 * a newly created or edited title is invisible to every cached listing until
 * those entries expire. Two minutes of a missing title is a bug report, so the
 * whole listing keyspace is dropped on any write.
 *
 * Dropping all of it rather than computing which hashes are affected is
 * deliberate: a title matches an unbounded set of filter combinations, so
 * targeted invalidation would have to enumerate them and would silently miss
 * one. Catalogue writes are rare and the entries are cheap to rebuild.
 */

const logger = createLogger({ name: 'api' });

export async function invalidateAnimeCaches(): Promise<void> {
  try {
    const pattern = `${namespacedKey(['anime-list'])}:*`;
    const deleted = await cacheInvalidatePattern(pattern);

    logger.debug('Invalidated anime listing cache', {
      module: 'catalogue',
      'data.deletedKeys': deleted,
    });
  } catch (error: unknown) {
    /*
     * A failed invalidation must not fail the write.
     *
     * The row is already committed; refusing the request now would tell the
     * author their edit did not happen when it did. The stale entry expires on
     * its own within the TTL.
     */
    logger.warn('Failed to invalidate anime cache', {
      module: 'catalogue',
      'data.error': String(error),
    });
  }
}
