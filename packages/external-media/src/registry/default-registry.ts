import {
  createByseProvider,
  createCdaProvider,
  genericProvider,
  createGoogleDriveProvider,
  createRumbleProvider,
  mp4uploadProvider,
  sibnetProvider,
  vidozaProvider,
  youtubeProvider,
} from '../providers/index.js';
import type { PlaybackCache } from '../cache/PlaybackCache.js';
import type { MediaLogger } from '../providers/google-drive/GoogleDriveTypes.js';
import type { ByseKeyValueCache } from '../providers/byse/ByseTypes.js';
import { ProviderRegistry } from './registry.js';

export interface CreateDefaultRegistryOptions {
  readonly playbackCache?: PlaybackCache;
  readonly logger?: MediaLogger;
  readonly throwOnHardFailure?: boolean;
  /**
   * Byse-specific configuration. Every field is optional; a caller that omits
   * this entirely still gets fully working iframe playback, just without the
   * optional `/get/domain`/`/file/info` enhancements — see `ByseProvider`.
   */
  readonly byse?: {
    readonly apiBase?: string;
    readonly apiKey?: string;
    readonly logoUrl?: string;
    readonly cache?: ByseKeyValueCache;
    /** Prefixes Byse's own cache keys. Defaults to `'playanime'`. */
    readonly namespace?: string;
  };
}

/**
 * The platform provider set.
 *
 * Registration order does not affect resolution — providers claim URLs by host,
 * and the generic fallback claims nothing — so this list is ordered for
 * readability, not precedence.
 */
export function createDefaultRegistry(options: CreateDefaultRegistryOptions = {}): ProviderRegistry {
  const drive = createGoogleDriveProvider({
    ...(options.playbackCache === undefined ? {} : { cache: options.playbackCache }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.throwOnHardFailure === undefined
      ? {}
      : { throwOnHardFailure: options.throwOnHardFailure }),
  });

  const rumble = createRumbleProvider({
    ...(options.playbackCache === undefined ? {} : { cache: options.playbackCache }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.throwOnHardFailure === undefined
      ? {}
      : { throwOnHardFailure: options.throwOnHardFailure }),
  });

  const cda = createCdaProvider({
    ...(options.playbackCache === undefined ? {} : { cache: options.playbackCache }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.throwOnHardFailure === undefined
      ? {}
      : { throwOnHardFailure: options.throwOnHardFailure }),
  });

  const byse = createByseProvider({
    ...(options.byse?.apiBase === undefined ? {} : { apiBase: options.byse.apiBase }),
    ...(options.byse?.apiKey === undefined ? {} : { apiKey: options.byse.apiKey }),
    ...(options.byse?.logoUrl === undefined ? {} : { logoUrl: options.byse.logoUrl }),
    ...(options.byse?.cache === undefined ? {} : { cache: options.byse.cache }),
    ...(options.byse?.namespace === undefined ? {} : { namespace: options.byse.namespace }),
    ...(options.playbackCache === undefined ? {} : { playbackCache: options.playbackCache }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.throwOnHardFailure === undefined
      ? {}
      : { throwOnHardFailure: options.throwOnHardFailure }),
  });

  return new ProviderRegistry(genericProvider)
    .register(youtubeProvider)
    .register(drive)
    .register(rumble)
    .register(cda)
    .register(byse)
    .register(vidozaProvider)
    .register(mp4uploadProvider)
    .register(sibnetProvider);
}

/**
 * Shared registry instance.
 *
 * Providers are stateless and the registry is immutable after construction, so
 * a single instance is safe to share across requests. The API builds its own
 * registry with Redis-backed caching via `createDefaultRegistry({ playbackCache })`.
 */
export const providerRegistry = createDefaultRegistry();
