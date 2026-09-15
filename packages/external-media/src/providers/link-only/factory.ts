import { ProviderEmbedPolicy, type MediaProviderId, type PlaybackDescriptor } from '@playanime/contracts';
import type {
  ExternalMediaProvider,
  ExternalMediaSource,
  ParsedExternalMedia,
  PlaybackContext,
  ProviderDefinition,
} from '../../types/index.js';
import { hostMatches } from '../../validation/url.js';

/**
 * Builds a provider that recognizes and normalizes a host's URLs but always
 * sends the viewer off-site.
 *
 * This is the correct shape for a provider whose embed mechanism PlayAnime has
 * not verified against published documentation and terms. Such a provider is
 * still genuinely useful: the URL is parsed, deduplicated by resource id,
 * moderated, and ranked like any other. It simply renders as "Otwórz u
 * dostawcy" rather than being framed.
 *
 * Promoting one to `EMBED` is a deliberate change requiring the provider's own
 * embed documentation to be cited in its definition. It is not something to be
 * inferred from observing what a page happens to permit.
 */
export interface LinkOnlyProviderSpec {
  readonly id: MediaProviderId;
  readonly label: string;
  readonly hosts: readonly string[];
  readonly displayHost: string;
  readonly reliabilityWeight: number;
  /** Why this provider is link-only. Surfaced in the moderation UI. */
  readonly embedNote: string;
  /** Extracts the provider-side id. Returns null when the URL is not a video. */
  readonly extractId: (url: URL) => string | null;
  /** Builds the canonical URL from an extracted id. */
  readonly canonicalize: (id: string) => string;
}

export function createLinkOnlyProvider(spec: LinkOnlyProviderSpec): ExternalMediaProvider {
  const definition: ProviderDefinition = {
    id: spec.id,
    label: spec.label,
    hosts: spec.hosts,
    embedPolicy: ProviderEmbedPolicy.LINK_ONLY,
    canEmitNative: false,
    // We do not probe providers whose API terms have not been reviewed.
    supportsAvailabilityCheck: false,
    reliabilityWeight: spec.reliabilityWeight,
    embedNote: spec.embedNote,
  };

  return {
    definition,

    supports(url: URL): boolean {
      return hostMatches(url.hostname, spec.hosts);
    },

    parse(url: URL): ParsedExternalMedia | null {
      const id = spec.extractId(url);
      if (id === null) return null;

      return {
        provider: spec.id,
        externalId: id,
        canonicalUrl: spec.canonicalize(id),
        displayHost: spec.displayHost,
      };
    },

    resolvePlayback(source: ExternalMediaSource, _context: PlaybackContext): PlaybackDescriptor {
      return {
        type: 'external',
        provider: spec.id,
        url: source.canonicalUrl,
        displayHost: spec.displayHost,
      };
    },
  };
}
