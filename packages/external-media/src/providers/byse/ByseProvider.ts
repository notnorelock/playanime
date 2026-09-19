import {
  MediaProviderId,
  ProviderEmbedPolicy,
  UnavailableReason,
  type NativePlayback,
  type PlaybackDescriptor,
  type PlaybackSource,
  type PlaybackTrack,
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
import type { BysePlayback, ByseProviderOptions } from './ByseTypes.js';
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
 * The documented embed player (`GET https://api.byse.sx/e/{file_code}`, or
 * the current domain from `/get/domain` when `BYSE_API_KEY` is configured)
 * is the guaranteed playback path and the fallback for every unresolved
 * case below.
 *
 * When `nativePlayback` is configured (see `ByseNativePlaybackOptions`),
 * real source/track URLs are resolved through Byse's own video-details API
 * instead — Byse's operator specifically authorized this integration to use
 * it. It is off by default and never assumed available: any failure at any
 * step (domain resolution, decrypt, an unmet captcha requirement) falls
 * straight back to the iframe, exactly like every other enhancement here.
 *
 * `/hls/link` (Premium Bandwidth) is out of scope. It is not implemented
 * and not faked.
 *
 * Progress: native playback uses the player's own `timeupdate` events, the
 * same as any other native `<video>` source. The iframe fallback path still
 * relies on the documented `byse-progress` postMessage event, bridged to
 * PlayAnime's normal watch-progress system by `@playanime/player`'s
 * `ByseProgressBridge`.
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
  // Native playback is opt-in (see `ByseProviderOptions.nativePlayback`) and
  // always falls back to the iframe, so this stays true regardless of
  // whether a given deployment has it enabled — matching how every other
  // `canEmitNative` provider in this package expresses "may", not "always
  // does".
  canEmitNative: true,
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

/**
 * True for a cached descriptor still safe to serve as-is.
 *
 * An iframe descriptor is re-validated against the embed allowlist — see the
 * allowlist's own doc for why a process restart clearing it in-memory does
 * not make a previously-legitimate host untrusted. A native descriptor's
 * source/track URLs are short-lived signed CDN links with their own
 * `expiresAt`, not subject to the embed-host check at all (that check exists
 * to stop a submitted/stored URL from being framed as if trusted, which does
 * not apply to a `<video>` `src`); it is valid exactly as long as it has not
 * expired.
 */
function isCachedDescriptorStillValid(
  descriptor: PlaybackDescriptor,
  allowlist: ByseEmbedHostAllowlist,
): boolean {
  if (descriptor.type === 'iframe') {
    try {
      return allowlist.isAllowed(new URL(descriptor.url).hostname);
    } catch {
      return false;
    }
  }

  if (descriptor.type === 'native') {
    if (descriptor.expiresAt === undefined) return true;
    return new Date(descriptor.expiresAt).getTime() > Date.now();
  }

  return false;
}

/** A valid `PlaybackSource.resolution` per the contract's own schema — an out-of-range or non-integer value is omitted rather than sent and rejected at the API boundary. */
function toValidResolution(height: number | undefined): number | undefined {
  if (height === undefined || !Number.isInteger(height) || height < 1 || height > 8640) {
    return undefined;
  }
  return height;
}

/** Converts a resolved `BysePlayback` into the public `NativePlayback` descriptor shape. */
function toNativeDescriptor(
  playback: BysePlayback,
  fallback: Extract<PlaybackDescriptor, { type: 'iframe' }>,
): NativePlayback {
  const sources: PlaybackSource[] = playback.sources.map((source) => {
    const resolution = toValidResolution(source.height);
    return {
      src: source.url,
      ...(resolution === undefined ? {} : { resolution }),
      ...(source.mimeType === undefined ? {} : { mimeType: source.mimeType }),
    };
  });

  // `language`/`label` are non-empty per the contract's own schema — an
  // empty string from Byse is omitted rather than sent and rejected at the
  // API boundary.
  const tracks: PlaybackTrack[] = playback.tracks.map((track) => ({
    src: track.url,
    ...(track.language === undefined || track.language.length === 0
      ? {}
      : { language: track.language.slice(0, 35) }),
    ...(track.title === undefined || track.title.length === 0
      ? {}
      : { label: track.title.slice(0, 100) }),
    ...(track.isDefault === undefined ? {} : { isDefault: track.isDefault }),
    ...(track.mimeType === undefined ? {} : { mimeType: track.mimeType }),
  }));

  return {
    type: 'native',
    provider: MediaProviderId.BYSE,
    sources,
    ...(tracks.length === 0 ? {} : { tracks }),
    fallback: { type: 'iframe', src: fallback.url, allow: fallback.allow, requiresSameOrigin: fallback.requiresSameOrigin },
    aspectRatio: 16 / 9,
  };
}

/**
 * Records every source/track host a resolved `BysePlayback` actually used,
 * so `isMediaUrlAllowed` can vouch for it. Called only with a value that
 * just came out of a successful decrypt — see the call site's own comment —
 * never with anything derived from a submitted or stored URL. Malformed
 * URLs are silently skipped here: they fail their own `assertMediaUrl`
 * check right after via a different path (a malformed host was never
 * "learned" as safe, so it stays rejected), not silently accepted.
 */
function learnMediaHosts(playback: BysePlayback, allowlist: ByseEmbedHostAllowlist): void {
  for (const source of playback.sources) {
    try {
      allowlist.learn(new URL(source.url).hostname);
    } catch {
      // Malformed URL: left unlearned, so assertMediaUrl still rejects it.
    }
  }
  for (const track of playback.tracks) {
    try {
      allowlist.learn(new URL(track.url).hostname);
    } catch {
      // Same as above.
    }
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
    // Native source URLs land on a per-request CDN host with no fixed
    // naming pattern (observed live: edge1-madrid-sprintcdn.<random>.com) —
    // there is no static allowlist that could ever cover it. Trust comes
    // from provenance, not the hostname: every such URL was decrypted from
    // Byse's own key-gated, AES-GCM-encrypted /playback response (see
    // `ByseResolver.nativePlayback`/`BysePlaybackCrypto`), the same trust
    // boundary `isEmbedUrlAllowed` already relies on for the resolved embed
    // domain — never a bare guess derived from submitted or stored input.
    // `learnMediaHosts` (below) records each host at the moment a
    // descriptor is actually built from that decrypted response, so this
    // check can never allow a host nothing has vouched for.
    isMediaUrlAllowed: (url: string) => {
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
        if (cached !== null && isCachedDescriptorStillValid(cached, allowlist)) return cached;
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

      const iframeDescriptor: Extract<PlaybackDescriptor, { type: 'iframe' }> = {
        type: 'iframe',
        provider: MediaProviderId.BYSE,
        url: embedUrl,
        allow: BYSE_EMBED_ALLOW,
        // Byse's player keeps playback/progress state against its own origin,
        // the same reason Rumble and Google Drive both need it.
        requiresSameOrigin: true,
        aspectRatio: 16 / 9,
      };

      // Native playback is only ever attempted when explicitly configured
      // (`ByseProviderOptions.nativePlayback`) — see `ByseResolver.nativePlayback`,
      // which returns `undefined` for every failure mode, so this is always a
      // safe upgrade attempt, never a new way for playback to fail.
      const native = await resolver.nativePlayback(fileCode);
      if (native !== undefined) learnMediaHosts(native, allowlist);
      const descriptor: PlaybackDescriptor =
        native !== undefined ? toNativeDescriptor(native, iframeDescriptor) : iframeDescriptor;

      if (options.playbackCache !== undefined) {
        // Short TTL: the resolved embed domain can change (and a native
        // descriptor's own signed URLs expire on their own schedule), so this
        // keeps a stale entry from being served long after either moves on.
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
