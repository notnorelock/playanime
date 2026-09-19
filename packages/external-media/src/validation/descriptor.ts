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
      assertEmbedUrl(descriptor.url, definition);
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

      for (const source of descriptor.sources) {
        assertMediaUrl(source.src, definition);
      }

      if (descriptor.fallback !== undefined) {
        assertEmbedUrl(descriptor.fallback.src, definition);
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

      assertMediaUrl(descriptor.src, definition);
      for (const source of descriptor.sources ?? []) {
        assertMediaUrl(source.src, definition);
      }

      if (descriptor.fallback !== undefined) {
        assertEmbedUrl(descriptor.fallback.src, definition);
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

function assertMediaUrl(value: string, definition: ProviderDefinition): void {
  assertHttpsUrl(value, definition);
  if (definition.isMediaUrlAllowed !== undefined) {
    if (!definition.isMediaUrlAllowed(value)) {
      throw new InternalError(`Provider ${definition.id} produced an unsafe media URL.`);
    }
    return;
  }
  assertHostIsClaimed(value, definition.mediaHosts ?? definition.hosts, definition);
}

/**
 * Checks a URL the player will actually frame — a top-level `iframe`
 * descriptor's own `url`, or the `fallback.src` a `native`/`hls` descriptor
 * carries. Both are the same trust question ("may this host be put in an
 * iframe"), so both go through `isEmbedUrlAllowed` when a provider defines
 * one — a provider like Byse, whose real embed domain is resolved at
 * request time rather than fixed, needs this for its `native` fallback
 * exactly as much as for a plain `iframe` descriptor; treating the two
 * differently would let a resolved-but-not-statically-listed domain fail
 * only on the fallback path, which was purely an oversight, not a
 * deliberate policy difference.
 */
function assertEmbedUrl(value: string, definition: ProviderDefinition): void {
  assertHttpsUrl(value, definition);
  if (definition.isEmbedUrlAllowed !== undefined) {
    if (!definition.isEmbedUrlAllowed(value)) {
      throw new InternalError(`Provider ${definition.id} produced an unsafe embed URL.`);
    }
    return;
  }
  assertHostIsClaimed(value, definition.hosts, definition);
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
