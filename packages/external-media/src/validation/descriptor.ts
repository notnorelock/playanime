import { InternalError } from '@playanime/shared';
import { ProviderEmbedPolicy, type PlaybackDescriptor } from '@playanime/contracts';
import type { ProviderDefinition } from '../types/index.js';
import { hostMatches } from './url.js';

/**
 * Final guard before a descriptor leaves the server.
 *
 * Providers are trusted code, but this is the one place where a mistake becomes
 * a security incident: an iframe URL built from unvalidated input, or a `native`
 * descriptor pointing at an unexpected origin. Re-checking here means a bug in
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
      assertHostIsClaimed(descriptor.url, definition.hosts, definition);
      return descriptor;
    }

    case 'native': {
      if (!definition.canEmitNative) {
        throw new InternalError(
          `Provider ${definition.id} must not produce a native descriptor without ` +
            'declaring canEmitNative.',
        );
      }
      if (descriptor.sources.length === 0) {
        throw new InternalError(`Provider ${definition.id} produced a native descriptor with no sources.`);
      }

      const mediaHosts = definition.mediaHosts ?? definition.hosts;
      for (const source of descriptor.sources) {
        assertHttpsUrl(source.src, definition);
        assertHostIsClaimed(source.src, mediaHosts, definition);
      }

      if (descriptor.fallback !== undefined) {
        assertHttpsUrl(descriptor.fallback.src, definition);
        assertHostIsClaimed(descriptor.fallback.src, definition.hosts, definition);
      }

      return descriptor;
    }

    case 'hls': {
      // Same gate as `native`: an adaptive playlist is still provider media,
      // so a provider must declare the capability to emit one.
      if (!definition.canEmitNative) {
        throw new InternalError(
          `Provider ${definition.id} must not produce an hls descriptor without ` +
            'declaring canEmitNative.',
        );
      }

      const mediaHosts = definition.mediaHosts ?? definition.hosts;
      assertHttpsUrl(descriptor.src, definition);
      assertHostIsClaimed(descriptor.src, mediaHosts, definition);

      if (descriptor.fallback !== undefined) {
        assertHttpsUrl(descriptor.fallback.src, definition);
        assertHostIsClaimed(descriptor.fallback.src, definition.hosts, definition);
      }

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
 * An embed or media URL must point at a host the provider declared.
 *
 * This is what stops a parsing bug from turning attacker-controlled input into
 * a frame of an arbitrary origin, or a native src pointing at an unexpected CDN.
 */
function assertHostIsClaimed(
  value: string,
  claimed: readonly string[],
  definition: ProviderDefinition,
): void {
  const host = new URL(value).hostname;
  if (!hostMatches(host, claimed)) {
    throw new InternalError(
      `Provider ${definition.id} produced a URL for unclaimed host "${host}".`,
    );
  }
}
