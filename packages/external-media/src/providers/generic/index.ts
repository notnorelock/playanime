import { MediaProviderId, ProviderEmbedPolicy, type PlaybackDescriptor } from '@playanime/contracts';
import type {
  ExternalMediaProvider,
  ExternalMediaSource,
  ParsedExternalMedia,
  PlaybackContext,
  ProviderDefinition,
} from '../../types/index.js';

/**
 * Fallback for a URL no dedicated provider claims.
 *
 * This is the reason "unknown source" can never become an iframe. An
 * unrecognized host produces an `external-link` source that renders as an
 * ordinary off-site link and enters moderation like any other submission. There
 * is no code path from "unknown URL" to "framed content".
 *
 * `supports()` returns false: the registry falls back to this provider
 * explicitly rather than letting it claim URLs during matching, which keeps
 * provider resolution order-independent.
 */

export const genericDefinition: ProviderDefinition = {
  id: MediaProviderId.EXTERNAL_LINK,
  label: 'Link zewnętrzny',
  // Claims no hosts: it is only ever reached as an explicit fallback.
  hosts: [],
  embedPolicy: ProviderEmbedPolicy.LINK_ONLY,
  canEmitNative: false,
  supportsAvailabilityCheck: false,
  reliabilityWeight: 0,
  embedNote: 'Unrecognized host. Always opens off-site; never embedded.',
};

export const genericProvider: ExternalMediaProvider = {
  definition: genericDefinition,

  supports(): boolean {
    return false;
  },

  parse(url: URL): ParsedExternalMedia | null {
    // Strip query and fragment: for an unknown host we cannot tell which
    // parameters are meaningful, and tracking parameters would defeat
    // deduplication.
    const canonical = new URL(url.toString());
    canonical.search = '';
    canonical.hash = '';

    const canonicalUrl = canonical.toString();

    return {
      provider: MediaProviderId.EXTERNAL_LINK,
      // Identity is the URL itself; there is no provider-side id to extract.
      externalId: canonicalUrl,
      canonicalUrl,
      displayHost: canonical.hostname.replace(/^www\./, ''),
    };
  },

  resolvePlayback(source: ExternalMediaSource, _context: PlaybackContext): PlaybackDescriptor {
    let displayHost: string;
    try {
      displayHost = new URL(source.canonicalUrl).hostname.replace(/^www\./, '');
    } catch {
      return {
        type: 'unavailable',
        provider: MediaProviderId.EXTERNAL_LINK,
        reason: 'provider_not_supported',
      };
    }

    return {
      type: 'external',
      provider: MediaProviderId.EXTERNAL_LINK,
      url: source.canonicalUrl,
      displayHost,
    };
  },
};
