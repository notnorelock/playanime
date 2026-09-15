export {
  rumbleDefinition,
  rumbleProvider,
  createRumbleProvider,
} from './RumbleProvider.js';
export type { RumbleProviderOptions } from './RumbleProvider.js';

export { RumbleResolver } from './RumbleResolver.js';
export {
  RumbleClient,
  defaultRumbleFetch,
  RumbleResponseTooLargeError,
  RumbleUnsafeRedirectError,
} from './RumbleClient.js';

export {
  parseRumbleUrl,
  parseRumbleOEmbed,
  parseRumblePlaybackMetadata,
  toRumbleSource,
} from './RumbleParser.js';
export type { RumbleUrlIdentity, RumbleOEmbedMetadata, RumblePlaybackMetadata } from './RumbleParser.js';

export {
  toPlaybackSources,
  toHlsVariants,
  pickAdaptiveSource,
  sortProgressiveSources,
  dedupeByResolution,
  withAllowedHostsOnly,
  highestResolution,
  isProgressive,
  isAdaptive,
} from './RumbleQualities.js';

export {
  RUMBLE_PAGE_HOSTS,
  RUMBLE_MEDIA_HOSTS,
  RUMBLE_EMBED_ALLOW,
  buildRumbleEmbedUrl,
  buildRumbleOEmbedUrl,
  buildRumblePlaybackMetadataUrl,
  isRumbleEmbedId,
  isRumblePageHost,
  isRumbleMediaHost,
  isFetchableRumbleUrl,
  isAllowedRumbleMediaUrl,
  parseEmbedToken,
  describeRumbleMediaUrl,
} from './RumbleUrls.js';

export type {
  RumbleSource,
  RumblePlaybackResult,
  RumblePlaybackSource,
  RumbleSubtitle,
  RumbleStreamType,
  RumbleLadderRung,
  RumbleLiveState,
  RumbleResolveOutcome,
  RumbleResolveStatus,
  RumbleResolverOptions,
  RumbleFetch,
  RumbleHttpResponse,
} from './RumbleTypes.js';
