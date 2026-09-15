import { InternalError } from '@playanime/shared';
import { ProviderEmbedPolicy, type PlaybackDescriptor } from '@playanime/contracts';
import type { ProviderDefinition } from '../types/index.js';
import { hostMatches } from './url.js';

/**
 * Final guard before a descriptor leaves the server.
 *
 * Providers are trusted code, but this is the one place where a mistake becomes
 * a security incident: an iframe URL built from unvalidated input, or a `native`
 * descriptor pointing at an extracted stream. Re-checking here means a bug in
 * one provider cannot become an exploit in the player.
 *
 * Throws `InternalError` rather than returning a flag: an illegal descriptor is
 * a programming error, and it must fail loudly in tests rather than degrade
 * quietly in production.
 */
export function assertDescriptorIsLegal(
  descriptor: PlaybackDescriptor,
  definition: ProviderDefinition,
): PlaybackDescriptor {
  if (descriptor.provider !== definition.id) {
    throw new InternalError(
      `Provider ${definition.id} produced a descriptor attributed to ${descriptor.provider}.`,
    );
  }

  switch (descriptor.type) {
    case 'iframe': {
      if (definition.embedPolicy !== ProviderEmbedPolicy.EMBED) {
        throw new InternalError(
          `Provider ${definition.id} is link-only and must not produce an iframe descriptor.`,
        );
      }
      assertHttpsUrl(descriptor.url, definition);
      assertHostIsClaimed(descriptor.url, definition);
      return descriptor;
    }

    case 'native': {
      if (!definition.canEmitNative) {
        throw new InternalError(
          `Provider ${definition.id} must not produce a native descriptor. Direct media URLs are ` +
            'only permitted for providers that publish them for this purpose; extracting a stream ' +
            'URL from a third-party host is out of scope for PlayAnime.',
        );
      }
      assertHttpsUrl(descriptor.url, definition);
      return descriptor;
    }

    case 'external': {
      assertHttpsUrl(descriptor.url, definition);
      return descriptor;
    }

    case 'unavailable': {
      if (descriptor.fallbackUrl !== undefined) {
        assertHttpsUrl(descriptor.fallbackUrl, definition);
      }
      return descriptor;
    }
  }
}

function assertHttpsUrl(value: string, definition: ProviderDefinition): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new InternalError(`Provider ${definition.id} produced a malformed URL.`);
  }

  // Mixed content would be blocked by the browser anyway, and an http embed
  // leaks the viewer's activity on the network path.
  if (parsed.protocol !== 'https:') {
    throw new InternalError(`Provider ${definition.id} produced a non-https URL.`);
  }
}

/**
 * An embed URL must point at a host the provider declared.
 *
 * This is what stops a parsing bug from turning attacker-controlled input into
 * a frame of an arbitrary origin.
 */
function assertHostIsClaimed(value: string, definition: ProviderDefinition): void {
  const host = new URL(value).hostname;
  if (!hostMatches(host, definition.hosts)) {
    throw new InternalError(
      `Provider ${definition.id} produced an embed URL for unclaimed host "${host}".`,
    );
  }
}
