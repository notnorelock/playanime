export {
  googleDriveDefinition,
  googleDriveProvider,
  createGoogleDriveProvider,
} from './GoogleDriveProvider.js';
export type { GoogleDriveProviderOptions } from './GoogleDriveProvider.js';

export { GoogleDriveResolver } from './GoogleDriveResolver.js';
export { GoogleDriveClient } from './GoogleDriveClient.js';

export {
  parseGoogleDriveUrl,
  extractGoogleDriveFileId,
  extractGoogleDriveResourceKey,
  parsePlaybackApiBody,
  parseVideoInfoBody,
  parseViewerHtml,
} from './GoogleDriveParser.js';

export {
  resolutionFromItag,
  sortAndDedupeVariants,
  highestResolution,
  isKnownItag,
} from './GoogleDriveQualities.js';

export {
  parseExpireParam,
  earliestExpiration,
  cacheTtlSeconds,
  isExpired,
} from './GoogleDriveExpiration.js';

export {
  buildGoogleDrivePreviewUrl,
  buildGoogleDriveViewUrl,
  isLikelySignedPlaybackUrl,
  describeMediaUrl,
  GOOGLE_DRIVE_MEDIA_HOSTS,
  GOOGLE_DRIVE_PAGE_HOSTS,
} from './GoogleDriveUrls.js';

export type {
  GoogleDriveSource,
  GoogleDrivePlaybackResult,
  GoogleDriveStreamVariant,
  GoogleDriveResolveOutcome,
  GoogleDriveResolverOptions,
  GoogleDriveFetch,
  MediaLogger,
} from './GoogleDriveTypes.js';
