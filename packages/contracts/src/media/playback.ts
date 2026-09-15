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
  UnavailablePlayback,
]);
export type PlaybackDescriptor = Static<typeof PlaybackDescriptor>;
export type IframePlayback = Static<typeof IframePlayback>;
export type ExternalPlayback = Static<typeof ExternalPlayback>;
export type NativePlayback = Static<typeof NativePlayback>;
export type PlaybackSource = Static<typeof PlaybackSource>;
export type IframePlaybackFallback = Static<typeof IframePlaybackFallback>;
export type UnavailablePlayback = Static<typeof UnavailablePlayback>;

export type PlaybackDescriptorOf<T extends PlaybackDescriptor['type']> = Extract<
  PlaybackDescriptor,
  { type: T }
>;
