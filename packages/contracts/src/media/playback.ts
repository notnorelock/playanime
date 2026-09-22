import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime } from '../common/index.js';
import { MEDIA_PROVIDER_IDS } from './providers.js';
import { literalUnion } from '../common/index.js';

const ProviderIdSchema = literalUnion(MEDIA_PROVIDER_IDS);

/**
 * How the player should render a source.
 *
 * This is the only playback information that crosses to the frontend. The web
 * app never sees provider internals, never constructs a provider URL itself,
 * and never decides embeddability — the server has already decided.
 */

/** Sandboxed third-party iframe, using the provider's documented embed URL. */
export const IframePlayback = Type.Object({
  type: Type.Literal('iframe'),
  provider: ProviderIdSchema,
  /** Always a provider-constructed embed URL, never raw user input. */
  url: Type.String({ format: 'uri' }),
  /** Value for the iframe `allow` attribute, decided per provider. */
  allow: Type.String(),
  /** Whether this provider's embed needs `allow-same-origin` in the sandbox. */
  requiresSameOrigin: Type.Boolean(),
  aspectRatio: Type.Optional(Type.Number({ minimum: 0.1, maximum: 10 })),
  /**
   * A direct-download link for this same file, when the provider documents
   * one — server-constructed exactly like `url`, never derived client-side
   * from it (the frontend never constructs a provider URL, only renders
   * one the server already decided on). Present for Byse today; omitted
   * for every provider that has no such documented endpoint.
   */
  downloadUrl: Type.Optional(Type.String({ format: 'uri' })),
});

/**
 * Off-site link. The viewer leaves PlayAnime.
 *
 * This is the correct fallback whenever a provider has no verified public embed
 * mechanism. It is not a degraded experience to be engineered around — it is
 * how PlayAnime respects a provider that has not offered embedding.
 */
export const ExternalPlayback = Type.Object({
  type: Type.Literal('external'),
  provider: ProviderIdSchema,
  url: Type.String({ format: 'uri' }),
  /** Host shown in the UI so the viewer knows where they are going. */
  displayHost: Type.String(),
});

/**
 * A single native media variant. Resolution is omitted when the provider did
 * not supply one — the player must not invent a label.
 */
export const PlaybackSource = Type.Object({
  src: Type.String({ format: 'uri' }),
  resolution: Type.Optional(Type.Integer({ minimum: 1, maximum: 8640 })),
  mimeType: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

/**
 * Iframe fallback attached to a native descriptor.
 *
 * Used when the native element cannot consume a variant (expired URL, provider
 * restriction) but the provider still offers a documented viewer.
 */
export const IframePlaybackFallback = Type.Object({
  type: Type.Literal('iframe'),
  src: Type.String({ format: 'uri' }),
  allow: Type.String(),
  requiresSameOrigin: Type.Boolean(),
});

/**
 * A subtitle/caption track accompanying a native source.
 *
 * Emitted only when a provider legitimately exposes real, resolved track
 * URLs alongside the video itself — never invented or guessed by PlayAnime.
 */
export const PlaybackTrack = Type.Object({
  src: Type.String({ format: 'uri' }),
  /** BCP-47-ish short code, when the provider supplied one. */
  language: Type.Optional(Type.String({ minLength: 1, maxLength: 35 })),
  /** Display label, when the provider supplied one distinct from the language code. */
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  isDefault: Type.Optional(Type.Boolean()),
  mimeType: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

/**
 * Direct media URLs played by the native `<video>` element.
 *
 * Emitted only when a provider legitimately exposes playback variants to the
 * current viewer — for example the transcodes Google Drive's own web player
 * requests for a file that viewer can already access. It is never a licence to
 * decrypt DRM, forge signatures, or read a file the caller cannot open.
 *
 * Temporary signed URLs belong here, never in PostgreSQL. `expiresAt` is the
 * earliest variant expiry so the player can refresh before they die.
 */
export const NativePlayback = Type.Object({
  type: Type.Literal('native'),
  provider: ProviderIdSchema,
  sources: Type.Array(PlaybackSource, { minItems: 1 }),
  /** Subtitle/caption tracks the provider resolved alongside the video, when it has any. */
  tracks: Type.Optional(Type.Array(PlaybackTrack)),
  expiresAt: Type.Optional(IsoDateTime),
  fallback: Type.Optional(IframePlaybackFallback),
  aspectRatio: Type.Optional(Type.Number({ minimum: 0.1, maximum: 10 })),
});

/**
 * A single variant advertised inside an HLS master playlist.
 *
 * Informational only: it lets the UI offer manual quality selection without
 * re-parsing the playlist. The player still fetches the master playlist and
 * the adaptive ladder remains authoritative, so an entry missing here never
 * makes a rendition unplayable.
 */
export const HlsVariant = Type.Object({
  resolution: Type.Integer({ minimum: 1, maximum: 8640 }),
  bandwidth: Type.Optional(Type.Integer({ minimum: 1 })),
});

/**
 * Adaptive HLS playback, driven by the player's HLS adapter.
 *
 * Preferred over `native` whenever a provider publishes a master playlist: one
 * URL, adaptive bitrate, and no manual segment handling. `src` is always the
 * master playlist — never an expanded segment list.
 *
 * Emitted under the same rule as `native`: only for streams a provider already
 * exposes to the current viewer through its own player. Never a licence to
 * decrypt DRM or forge access.
 */
export const HlsPlayback = Type.Object({
  type: Type.Literal('hls'),
  provider: ProviderIdSchema,
  /** Master playlist URL (`application/vnd.apple.mpegurl`). */
  src: Type.String({ format: 'uri' }),
  /**
   * Optional separate playlists for manual quality selection. These are actual
   * resolved URLs, not claims about the levels inside the default playlist.
   */
  sources: Type.Optional(Type.Array(PlaybackSource, { minItems: 1 })),
  /** Subtitle/caption tracks the provider resolved alongside the stream, when it has any. */
  tracks: Type.Optional(Type.Array(PlaybackTrack)),
  /** True for a live edge stream, where duration is not fixed. */
  live: Type.Optional(Type.Boolean()),
  /** Renditions the master playlist advertises, highest first. */
  variants: Type.Optional(Type.Array(HlsVariant)),
  expiresAt: Type.Optional(IsoDateTime),
  fallback: Type.Optional(IframePlaybackFallback),
  aspectRatio: Type.Optional(Type.Number({ minimum: 0.1, maximum: 10 })),
});

export const UnavailablePlayback = Type.Object({
  type: Type.Literal('unavailable'),
  provider: ProviderIdSchema,
  reason: Type.String(),
  /** Off-site URL offered as a fallback when one exists. */
  fallbackUrl: Type.Optional(Type.String({ format: 'uri' })),
});

export const PlaybackDescriptor = Type.Union([
  IframePlayback,
  ExternalPlayback,
  NativePlayback,
  HlsPlayback,
  UnavailablePlayback,
]);
export type PlaybackDescriptor = Static<typeof PlaybackDescriptor>;
export type IframePlayback = Static<typeof IframePlayback>;
export type ExternalPlayback = Static<typeof ExternalPlayback>;
export type NativePlayback = Static<typeof NativePlayback>;
export type HlsPlayback = Static<typeof HlsPlayback>;
export type HlsVariant = Static<typeof HlsVariant>;
export type PlaybackSource = Static<typeof PlaybackSource>;
export type PlaybackTrack = Static<typeof PlaybackTrack>;
export type IframePlaybackFallback = Static<typeof IframePlaybackFallback>;
export type UnavailablePlayback = Static<typeof UnavailablePlayback>;

export type PlaybackDescriptorOf<T extends PlaybackDescriptor['type']> = Extract<
  PlaybackDescriptor,
  { type: T }
>;
