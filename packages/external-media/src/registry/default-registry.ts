import {
  cdaProvider,
  genericProvider,
  googleDriveProvider,
  mp4uploadProvider,
  sibnetProvider,
  vidozaProvider,
  youtubeProvider,
} from '../providers/index.js';
import { ProviderRegistry } from './registry.js';

/**
 * The platform provider set.
 *
 * Registration order does not affect resolution — providers claim URLs by host,
 * and the generic fallback claims nothing — so this list is ordered for
 * readability, not precedence.
 */
export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry(genericProvider)
    .register(youtubeProvider)
    .register(googleDriveProvider)
    .register(cdaProvider)
    .register(vidozaProvider)
    .register(mp4uploadProvider)
    .register(sibnetProvider);
}

/**
 * Shared registry instance.
 *
 * Providers are stateless and the registry is immutable after construction, so
 * a single instance is safe to share across requests. Tests that need a custom
 * provider set build their own with `new ProviderRegistry(...)`.
 */
export const providerRegistry = createDefaultRegistry();
