import {
  MediaProviderId,
  ProviderEmbedPolicy,
  UnavailableReason,
  type PlaybackDescriptor,
} from '@playanime/contracts';
import { ExternalMediaUnsupportedProviderError } from '../../errors.js';
import type {
  ExternalMediaProvider,
  ExternalMediaSource,
  ParsedExternalMedia,
  PlaybackContext,
  ProviderDefinition,
  SourceAvailability,
} from '../../types/index.js';
import { buildByseEmbedPlayerUrl } from './ByseEmbed.js';
import { parseByseUrl, toByseSource } from './ByseParser.js';
import { ByseResolver } from './ByseResolver.js';
import type { ByseProviderOptions } from './ByseTypes.js';
import {
  BYSE_DEFAULT_API_BASE,
  BYSE_EMBED_ALLOW,
  ByseEmbedHostAllowlist,
  buildByseEmbedUrl,
  isByseFileCode,
  isByseSourceHost,
} from './ByseUrls.js';

/**
 * Byse.
 *
 * The normal and only required playback path is the documented embed player
 * (`GET https://api.byse.sx/e/{file_code}`, or the current domain from
 * `/get/domain` when `BYSE_API_KEY` is configured). Native HLS resolution is
 * intentionally not implemented: Byse does not document one, and the
 * documented iframe already gives every viewer a working player without
 * depending on undocumented playback internals.
 *
 * `/hls/link` (Premium Bandwidth) and reverse-engineered playback are out of
 * scope on purpose — see the package README.
 *
 * Progress comes from the documented `byse-progress` postMessage event,
 * bridged to PlayAnime's normal watch-progress system by the player layer
 * (`@playanime/web`'s `VideoPlayer.vue`), not from anything resolved here.
 */

export const byseDefinition: ProviderDefinition = {
  id: MediaProviderId.BYSE,
  label: 'Byse',
  // Byse mirrors its source pages across rotating "byse"-branded domains, so
  // intake recognizes the whole family rather than one fixed host — see
  // `isByseSourceHost`. This list is never consulted for iframe legality
  // (`isEmbedUrlAllowed` below replaces that check with the actual resolved
  // allowlist); it exists for provider metadata/display and for a
  // `frame-src` CSP policy derived from it, which — unlike
  // `isEmbedUrlAllowed` — is necessarily a static snapshot and cannot express
  // a domain `/get/domain` has not returned yet.
  hosts: ['byse.sx', 'api.byse.sx'],
  embedPolicy: ProviderEmbedPolicy.EMBED,
  canEmitNative: false,
  // Liveness is available only with an API key, via the documented
  // `/file/info` endpoint; `checkAvailability` itself degrades without one.
  supportsAvailabilityCheck: true,
  reliabilityWeight: 50,
};

function unavailableDescriptor(
  reason: UnavailableReason,
  fallbackUrl?: string,
): Extract<PlaybackDescriptor, { type: 'unavailable' }> {
  return {
    type: 'unavailable',
    provider: MediaProviderId.BYSE,
    reason,
    ...(fallbackUrl === undefined ? {} : { fallbackUrl }),
  };
}

/** True for a descriptor this provider can legally have produced, host-wise. */
function hasAllowedEmbedHost(descriptor: PlaybackDescriptor, allowlist: ByseEmbedHostAllowlist): boolean {
  if (descriptor.type !== 'iframe') return false;
  try {
    return allowlist.isAllowed(new URL(descriptor.url).hostname);
  } catch {
    return false;
  }
}

export function createByseProvider(options: ByseProviderOptions = {}): ExternalMediaProvider {
  const resolver = new ByseResolver(options);
  const apiBase = options.apiBase ?? BYSE_DEFAULT_API_BASE;
  const logoUrl = options.logoUrl;
  const throwOnHardFailure = options.throwOnHardFailure ?? false;

  /**
   * Append-only, shared across every request this provider instance serves.
   * See `ByseEmbedHostAllowlist`'s own doc for why that is safe under
   * concurrency: it only ever grows, and `isEmbedUrlAllowed` only ever reads.
   */
  const allowlist = new ByseEmbedHostAllowlist();

  const definition: ProviderDefinition = {
    ...byseDefinition,
    isEmbedUrlAllowed: (url: string) => {
      try {
        return allowlist.isAllowed(new URL(url).hostname);
      } catch {
        return false;
      }
    },
  };

  return {
    definition,

    supports(url: URL): boolean {
      return isByseSourceHost(url.hostname);
    },

    parse(url: URL): ParsedExternalMedia | null {
      const fileCode = parseByseUrl(url);
      if (fileCode === null) return null;

      const source = toByseSource(fileCode);
      return {
        provider: MediaProviderId.BYSE,
        externalId: source.fileCode,
        canonicalUrl: source.canonicalUrl,
        displayHost: 'byse.sx',
      };
    },

    async resolvePlayback(
      source: ExternalMediaSource,
      context: PlaybackContext,
    ): Promise<PlaybackDescriptor> {
      const fileCode = source.externalId;
      if (!isByseFileCode(fileCode)) {
        if (throwOnHardFailure) throw new ExternalMediaUnsupportedProviderError();
        return unavailableDescriptor(UnavailableReason.PROVIDER_NOT_SUPPORTED);
      }

      if (options.playbackCache !== undefined) {
        const cached = await options.playbackCache.get(MediaProviderId.BYSE, fileCode, null);
        // A cached descriptor may have been written before a process restart
        // cleared the in-memory allowlist (or by a different instance). Its
        // host was legitimate when built — from this same resolver's
        // `resolveEmbedDomain`, never from user input — so it is re-learned
        // here rather than rejected as if it were untrusted.
        if (cached !== null && hasAllowedEmbedHost(cached, allowlist)) return cached;
      }

      // Optional health check: a source Byse itself reports as unplayable is
      // reported as unavailable rather than handed an iframe that will fail.
      // Absent an API key, or on any lookup failure, this is skipped entirely
      // — see `ByseResolver.fileInfo`, which never throws.
      const info = await resolver.fileInfo(fileCode);
      if (info !== undefined && !info.canPlay) {
        return unavailableDescriptor(
          UnavailableReason.UPSTREAM_UNAVAILABLE,
          buildByseEmbedUrl(fileCode, apiBase),
        );
      }

      const resolvedDomain = await resolver.resolveEmbedDomain();
      const effectiveBase = resolvedDomain !== undefined ? `https://${resolvedDomain}` : apiBase;
      if (resolvedDomain !== undefined) allowlist.learn(resolvedDomain);

      // `buildByseEmbedPlayerUrl` also accepts `subtitles` (documented
      // cX_file/cX_label pairs), fully implemented and tested. It is not
      // passed here because PlayAnime's `EpisodeSource` model has no
      // multi-track-subtitle representation to pass in yet — see the
      // provider README. Poster/logo already thread through today.
      const embedUrl = buildByseEmbedPlayerUrl(fileCode, effectiveBase, {
        autoplay: context.autoplay,
        ...(context.posterUrl === undefined ? {} : { posterUrl: context.posterUrl }),
        ...(logoUrl === undefined ? {} : { logoUrl }),
      });

      const descriptor: PlaybackDescriptor = {
        type: 'iframe',
        provider: MediaProviderId.BYSE,
        url: embedUrl,
        allow: BYSE_EMBED_ALLOW,
        // Byse's player keeps playback/progress state against its own origin,
        // the same reason Rumble and Google Drive both need it.
        requiresSameOrigin: true,
        aspectRatio: 16 / 9,
      };

      if (options.playbackCache !== undefined) {
        // Short TTL: the resolved embed domain can change, and this keeps a
        // stale domain from being served long after `/get/domain` moves on.
        await options.playbackCache.set(MediaProviderId.BYSE, fileCode, null, descriptor, undefined, 300);
      }

      return descriptor;
    },

    /**
     * Liveness via `/file/info` only, and only when `BYSE_API_KEY` is
     * configured. Without one, this reports `unknown` rather than probing —
     * the same "no key, no check" degrade documented for the provider as a
     * whole, and consistent with `supportsAvailabilityCheck` staying true so
     * a caller can still call this and get a meaningful "unknown".
     */
    async checkAvailability(source: ExternalMediaSource): Promise<SourceAvailability> {
      const checkedAt = new Date();
      const fileCode = source.externalId;

      if (!isByseFileCode(fileCode)) {
        return { status: 'unavailable', checkedAt, detail: 'invalid_file_code' };
      }

      const info = await resolver.fileInfo(fileCode);
      if (info === undefined) {
        return { status: 'unknown', checkedAt, detail: 'file_info_unavailable' };
      }

      // A single failed lookup never marks a source dead (handled by
      // `fileInfo` returning `undefined` on failure, above); this only fires
      // for an explicit, successful "not playable" answer from Byse itself.
      if (!info.canPlay) {
        return { status: 'unavailable', checkedAt, detail: 'canplay_false' };
      }

      return { status: 'available', checkedAt };
    },
  };
}

/** Default instance; the API registry creates its own instance with Redis caching. */
export const byseProvider = createByseProvider();
