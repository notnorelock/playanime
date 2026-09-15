import { Type, type Static } from '@sinclair/typebox';
import { MEDIA_PROVIDER_IDS } from './providers.js';

const ProviderIdSchema = Type.Union(MEDIA_PROVIDER_IDS.map((id) => Type.Literal(id)));

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
 * Direct media URL played by the native `<video>` element.
 *
 * Emitted **only** when a provider legitimately publishes a media URL intended
 * for direct playback — for example a rights-holder's own CDN, or PlayAnime's
 * own trailers and promotional clips.
 *
 * It is never produced by extracting an internal or temporary URL from a
 * third-party host. Providers declare `canEmitNative` in their definition and
 * every third-party host provider declares it `false`, so this branch is
 * unreachable for them by construction rather than by policy.
 */
export const NativePlayback = Type.Object({
  type: Type.Literal('native'),
  provider: ProviderIdSchema,
  url: Type.String({ format: 'uri' }),
  mimeType: Type.Optional(Type.String()),
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
export type UnavailablePlayback = Static<typeof UnavailablePlayback>;

export type PlaybackDescriptorOf<T extends PlaybackDescriptor['type']> = Extract<
  PlaybackDescriptor,
  { type: T }
>;
