/**
 * Search-parameter helpers.
 *
 * `useSearchParams` types every value as `string | string[] | undefined`,
 * because a query string may legitimately repeat a key (`?genre=a&genre=b`).
 * The catalogue treats each filter as single-valued, so these narrow at the
 * boundary rather than every call site asserting the type away.
 */

/** First value of a possibly-repeated parameter. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Narrows a parameter to a known set of values.
 *
 * Returns undefined for anything not in the set, so a hand-edited URL
 * (`?sort=drop%20table`) falls back to the default rather than reaching the API
 * as an unvalidated filter.
 */
export function enumParam<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const first = firstParam(value);
  if (first === undefined) return undefined;
  return (allowed as readonly string[]).includes(first) ? (first as T) : undefined;
}
