/**
 * Branded ID types.
 *
 * A bare `string` for every identifier means `getAnime(userId)` compiles.
 * Branding makes that a type error at no runtime cost.
 */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type ProfileId = Brand<string, 'ProfileId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type AnimeId = Brand<string, 'AnimeId'>;
export type FranchiseId = Brand<string, 'FranchiseId'>;
export type SeasonId = Brand<string, 'SeasonId'>;
export type EpisodeId = Brand<string, 'EpisodeId'>;
export type EpisodeSourceId = Brand<string, 'EpisodeSourceId'>;
export type ListId = Brand<string, 'ListId'>;
export type WatchPartyId = Brand<string, 'WatchPartyId'>;

/**
 * Asserts that a string is an ID of the given brand.
 *
 * Call this only at trust boundaries — after schema validation, or when reading
 * a column the database guarantees. Everywhere else, accept the branded type.
 */
// The type parameter appears once by design: the caller chooses the brand at
// the call site (`asId<UserId>(row.id)`), which is the whole purpose of this
// helper. Inferring it from an argument would defeat that.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function asId<T extends Brand<string, string>>(value: string): T {
  return value as T;
}

/** RFC 4122 v4 UUID. Backed by the platform CSPRNG. */
export const newUuid = (): string => crypto.randomUUID();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

/**
 * URL-safe random token, e.g. session identifiers and verification tokens.
 * `bytes` is raw entropy; 32 bytes yields a 43-character token.
 */
export function newToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
