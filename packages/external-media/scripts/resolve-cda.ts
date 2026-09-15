/**
 * Resolve a CDA video through the same provider the API uses, without a
 * database, Redis, or a running PlayAnime server.
 *
 * Usage:
 *   bun run packages/external-media/scripts/resolve-cda.ts <cda-url-or-video-id>
 *
 * Prints the normalized playback descriptor, including temporary media URLs.
 * This is a local development helper; its output should not enter production
 * logs. Player tokens and raw CDA responses are never printed.
 */
import { MediaProviderId } from '@playanime/contracts';
import { cdaPageUrl, createCdaProvider, extractCdaVideoId } from '../src/providers/cda/index.js';
import type { ExternalMediaSource, PlaybackContext } from '../src/types/index.js';
import { assertDescriptorIsLegal } from '../src/validation/descriptor.js';

const input = process.argv[2];
if (input === undefined || input.trim() === '') {
  console.error('Usage: bun run packages/external-media/scripts/resolve-cda.ts <cda-url-or-video-id>');
  process.exit(1);
}

// Validate before creating any network request. Both supported URL forms and
// internal raw IDs converge on the same canonical CDA page.
const externalId = extractCdaVideoId(input.trim());
if (externalId === null) {
  console.error('CDA_INVALID_URL: expected a CDA video URL or video ID.');
  process.exit(1);
}

const provider = createCdaProvider({
  throwOnHardFailure: true,
  logger: {
    info: (message, context) => {
      console.error(`  [info] ${message}`, context ?? {});
    },
    warn: (message, context) => {
      console.error(`  [warn] ${message}`, context ?? {});
    },
    error: (message) => {
      console.error(`  [error] ${message}`);
    },
  },
});

const source: ExternalMediaSource = {
  id: 'script',
  provider: MediaProviderId.CDA,
  externalId,
  canonicalUrl: cdaPageUrl(externalId),
  resourceKey: null,
  audioLanguage: null,
  subtitleLanguage: null,
  qualityHint: null,
  metadata: {},
};

const context: PlaybackContext = {
  embedOrigin: 'https://playani.me',
  locale: 'pl',
  autoplay: false,
};

try {
  // Apply the registry's output guard as well, so this helper checks the same
  // descriptor boundary as the API. No cache is attached: every run is fresh.
  const descriptor = assertDescriptorIsLegal(
    await provider.resolvePlayback(source, context),
    provider.definition,
  );

  console.log(JSON.stringify({ externalId, canonicalUrl: source.canonicalUrl, descriptor }, null, 2));

  if (descriptor.type === 'unavailable') {
    process.exitCode = 1;
  }
} catch (error) {
  // Provider errors contain safe messages. Do not print their causes or full
  // objects, which could include details from an underlying transport failure.
  console.error(error instanceof Error ? error.message : 'CDA playback resolution failed.');
  process.exitCode = 1;
}
