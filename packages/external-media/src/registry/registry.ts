import { ConflictError, NotFoundError } from '@playanime/shared';
import {
  MediaProviderId,
  ProviderEmbedPolicy,
  UnavailableReason,
  type PlaybackDescriptor,
} from '@playanime/contracts';
import type {
  ExternalMediaProvider,
  ExternalMediaSource,
  ParsedExternalMedia,
  PlaybackContext,
} from '../types/index.js';
import { assertDescriptorIsLegal } from '../validation/descriptor.js';

/**
 * Central provider resolution.
 *
 * Every "which provider is this?" question in the platform goes through here.
 * Without it, provider detection metastasizes into `url.includes('youtube')`
 * checks in controllers and components, each with its own subtly different
 * (and subtly wrong) host matching.
 */
export class ProviderRegistry {
  private readonly providers = new Map<MediaProviderId, ExternalMediaProvider>();
  private readonly fallback: ExternalMediaProvider;

  constructor(fallback: ExternalMediaProvider) {
    this.fallback = fallback;
    this.providers.set(fallback.definition.id, fallback);
  }

  register(provider: ExternalMediaProvider): this {
    const { id } = provider.definition;
    if (this.providers.has(id) && id !== this.fallback.definition.id) {
      throw new ConflictError(`Provider "${id}" is already registered.`);
    }
    this.providers.set(id, provider);
    return this;
  }

  /** Every registered provider, including the fallback. */
  all(): readonly ExternalMediaProvider[] {
    return [...this.providers.values()];
  }

  /** Providers a user may submit to, i.e. everything but the fallback. */
  submittable(): readonly ExternalMediaProvider[] {
    return this.all().filter((provider) => provider.definition.id !== this.fallback.definition.id);
  }

  get(id: MediaProviderId): ExternalMediaProvider {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      // A stored source references an unregistered provider: it was removed
      // from the allowlist. Surfaced as not-found so playback degrades rather
      // than crashing the request.
      throw new NotFoundError(`Provider "${id}" is not registered.`);
    }
    return provider;
  }

  has(id: MediaProviderId): boolean {
    return this.providers.has(id);
  }

  /**
   * Finds the provider claiming a URL.
   *
   * Never returns null: an unclaimed URL resolves to the fallback, which is
   * always link-only. This is what guarantees an unknown host cannot become an
   * embed.
   */
  resolve(url: URL): ExternalMediaProvider {
    for (const provider of this.providers.values()) {
      if (provider.supports(url)) return provider;
    }
    return this.fallback;
  }

  /**
   * Parses a URL with its provider.
   *
   * A host-matching provider that cannot parse the URL (a YouTube channel page,
   * say) falls through to the fallback rather than being rejected, so the link
   * is still submittable as a plain external link.
   */
  parse(url: URL): ParsedExternalMedia {
    const provider = this.resolve(url);
    const parsed = provider.parse(url);
    if (parsed !== null) return parsed;

    const generic = this.fallback.parse(url);
    if (generic === null) {
      throw new NotFoundError('URL could not be interpreted as a media source.');
    }
    return generic;
  }

  /**
   * Builds the playback descriptor for a stored source.
   *
   * The descriptor is validated before it is returned, so a provider bug cannot
   * put an illegal URL in front of the player.
   */
  resolvePlayback(source: ExternalMediaSource, context: PlaybackContext): Promise<PlaybackDescriptor> {
    const provider = this.get(source.provider);
    return Promise.resolve(provider.resolvePlayback(source, context)).then((descriptor) =>
      assertDescriptorIsLegal(descriptor, provider.definition),
    );
  }

  /** Whether a provider may be rendered in an iframe. */
  canEmbed(id: MediaProviderId): boolean {
    return this.has(id) && this.get(id).definition.embedPolicy === ProviderEmbedPolicy.EMBED;
  }

  /**
   * Origins permitted in the `frame-src` CSP directive.
   *
   * Derived from the registry rather than maintained by hand, so a provider
   * cannot be embeddable without also being in the policy — and removing one
   * tightens the policy automatically.
   */
  frameSrcOrigins(): readonly string[] {
    const origins = new Set<string>();

    for (const provider of this.providers.values()) {
      if (provider.definition.embedPolicy !== ProviderEmbedPolicy.EMBED) continue;
      for (const host of provider.definition.hosts) {
        origins.add(`https://${host}`);
        origins.add(`https://*.${host}`);
      }
    }

    return [...origins].sort();
  }

  /** Descriptor for a source that exists but may not be played. */
  unavailable(id: MediaProviderId, reason: UnavailableReason, fallbackUrl?: string): PlaybackDescriptor {
    return {
      type: 'unavailable',
      provider: this.has(id) ? id : MediaProviderId.EXTERNAL_LINK,
      reason,
      ...(fallbackUrl === undefined ? {} : { fallbackUrl }),
    };
  }
}
