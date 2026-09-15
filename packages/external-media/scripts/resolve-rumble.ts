/**
 * Resolves a real Rumble URL end to end, against the live provider.
 *
 * Mirrors `resolve-drive.ts`. Prints the normalized descriptor the player would
 * receive, so provider behaviour can be checked against an actual video without
 * a database or a running API.
 *
 *   bun packages/external-media/scripts/resolve-rumble.ts <rumble-url>
 */
import { MediaProviderId } from '@playanime/contracts';
import { createRumbleProvider } from '../src/providers/rumble/index.js';
import { parseSubmittedUrl } from '../src/validation/url.js';
import type { ExternalMediaSource, PlaybackContext } from '../src/types/index.js';

const input = process.argv[2];
if (input === undefined) {
  console.error('Usage: bun resolve-rumble.ts <rumble-url>');
  process.exit(1);
}

const logger = {
  info: (message: string, context?: Record<string, unknown>) => {
    console.log(`  [info] ${message}`, context ?? '');
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    console.log(`  [warn] ${message}`, context ?? '');
  },
  error: (message: string, error?: unknown) => {
    console.log(`  [error] ${message}`, error instanceof Error ? error.message : error);
  },
};

const provider = createRumbleProvider({ logger, throwOnHardFailure: false });

const url = parseSubmittedUrl(input);
console.log(`\nURL        ${input}`);
console.log(`claimed by ${provider.supports(url) ? 'rumble' : 'NOT rumble'}`);

const parsed = provider.parse(url);
if (parsed === null) {
  console.error('\nNot parseable as a Rumble video.');
  process.exit(1);
}

console.log(`externalId ${parsed.externalId}`);
console.log(`canonical  ${parsed.canonicalUrl}`);
console.log(`identity   ${String(parsed.metadata?.['identity'])}`);

const source: ExternalMediaSource = {
  id: 'script',
  provider: MediaProviderId.RUMBLE,
  externalId: parsed.externalId,
  resourceKey: null,
  canonicalUrl: parsed.canonicalUrl,
  audioLanguage: null,
  subtitleLanguage: null,
  qualityHint: null,
  metadata: parsed.metadata ?? {},
};

const context: PlaybackContext = {
  embedOrigin: 'https://playani.me',
  locale: 'pl',
  autoplay: false,
};

console.log('\nresolving...');
const descriptor = await provider.resolvePlayback(source, context);

console.log(`\ndescriptor ${descriptor.type}`);

if (descriptor.type === 'hls') {
  console.log(`  src       ${descriptor.src}`);
  console.log(`  live      ${String(descriptor.live)}`);
  console.log(`  variants  ${(descriptor.variants ?? []).map((v) => `${String(v.resolution)}p`).join(', ') || '(none)'}`);
  console.log(`  fallback  ${descriptor.fallback?.src ?? '(none)'}`);
} else if (descriptor.type === 'native') {
  for (const s of descriptor.sources) {
    console.log(`  ${String(s.resolution ?? '?')}p  ${s.mimeType ?? ''}  ${s.src.slice(0, 80)}`);
  }
  console.log(`  fallback  ${descriptor.fallback?.src ?? '(none)'}`);
} else if (descriptor.type === 'iframe') {
  console.log(`  url       ${descriptor.url}`);
} else if (descriptor.type === 'unavailable') {
  console.log(`  reason    ${descriptor.reason}`);
  console.log(`  fallback  ${descriptor.fallbackUrl ?? '(none)'}`);
}

const availability = await provider.checkAvailability?.(source);
if (availability !== undefined) {
  console.log(`\navailability ${availability.status}${availability.detail === undefined ? '' : ` (${availability.detail})`}`);
}
