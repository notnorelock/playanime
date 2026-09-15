import { Type, type Static, type TSchema } from '@sinclair/typebox';

/** ISO-8601 timestamp. Dates cross the wire as strings, never as `Date`. */
export const IsoDateTime = Type.String({ format: 'date-time' });

export const Uuid = Type.String({ format: 'uuid' });

export const Slug = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' });

/** Query parameters for a cursor-paginated collection. */
export const CursorQuery = Type.Object({
  cursor: Type.Optional(Type.String({ maxLength: 512 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 24 })),
});
export type CursorQuery = Static<typeof CursorQuery>;

/**
 * Wraps an item schema in the standard page envelope.
 *
 * Every list endpoint returns this shape, so the frontend has exactly one
 * pagination code path.
 */
export const CursorPageOf = <T extends TSchema>(item: T) =>
  Type.Object({
    items: Type.Array(item),
    nextCursor: Type.Union([Type.String(), Type.Null()]),
    hasMore: Type.Boolean(),
  });

/** The error envelope. Mirrors `serializeError` in @playanime/shared. */
export const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    issues: Type.Optional(
      Type.Array(Type.Object({ path: Type.String(), message: Type.String() })),
    ),
    requestId: Type.Optional(Type.String()),
  }),
});
export type ErrorResponse = Static<typeof ErrorResponse>;

/** Image reference returned wherever artwork is exposed. */
export const ImageRef = Type.Object({
  url: Type.String({ format: 'uri' }),
  blurhash: Type.Union([Type.String(), Type.Null()]),
  width: Type.Union([Type.Integer(), Type.Null()]),
  height: Type.Union([Type.Integer(), Type.Null()]),
});
export type ImageRef = Static<typeof ImageRef>;
