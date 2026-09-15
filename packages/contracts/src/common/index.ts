import { Type, type Static, type TLiteral, type TSchema, type TUnion } from '@sinclair/typebox';

/**
 * Builds a TypeBox union of string literals from a const array.
 *
 * The generic parameter is what makes this work: without it, mapping over a
 * `readonly string[]` produces `TLiteral<string>`, TypeBox widens the union to
 * plain `string`, and Elysia — which derives its response type from the schema
 * — narrows the handler's return type to `never`. Every enum-valued field then
 * fails to typecheck for reasons that point at the handler rather than here.
 *
 * Preserving the literal union keeps the runtime validator and the static type
 * in agreement, which is the entire reason contracts are defined once.
 */
export const literalUnion = <T extends string>(
  values: readonly T[],
): TUnion<TLiteral<T>[]> => Type.Union(values.map((value) => Type.Literal(value)));

/** ISO-8601 timestamp. Dates cross the wire as strings, never as `Date`. */
export const IsoDateTime = Type.String({ format: 'date-time' });

export const Uuid = Type.String({ format: 'uuid' });

export const Slug = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' });

/** Query parameters for a cursor-paginated collection. */
export const CursorQuery = Type.Object({
  cursor: Type.Optional(Type.String({ maxLength: 512 })),
  /**
   * Page size.
   *
   * Typed as a union of number and numeric string because query parameters are
   * always strings on the wire: `?limit=24` arrives as `"24"`, which a bare
   * `Type.Integer()` rejects before the handler runs. Elysia's `normalize`
   * strips unknown properties but does not coerce types, and the coercion that
   * does exist applies to `t.Numeric`, which is Elysia-specific and would tie
   * this package to the server framework.
   *
   * Accepting both keeps the contract usable by the frontend (which sends a
   * number) and correct at the HTTP edge. `clampPageSize` in
   * `@playanime/shared` parses and bounds the value.
   */
  limit: Type.Optional(
    Type.Union([
      Type.Integer({ minimum: 1, maximum: 100 }),
      Type.String({ pattern: '^[1-9][0-9]{0,2}$' }),
    ]),
  ),
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
