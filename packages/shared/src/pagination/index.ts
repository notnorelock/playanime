/**
 * Pagination primitives shared by the API, the contracts package, and the web
 * client.
 *
 * PlayAnime uses **cursor pagination** for feeds and catalogue listings. Offset
 * pagination degrades on large tables (`OFFSET 50000` still scans 50k rows) and
 * skips or duplicates rows when the underlying set changes between pages —
 * unacceptable for an infinite-scrolling catalogue.
 */

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Clamps a client-supplied page size into the allowed range.
 *
 * Accepts a string as well as a number: query parameters arrive as strings over
 * HTTP, and parsing them in one place is safer than expecting every caller to
 * coerce first — a forgotten coercion would silently fall back to the default
 * rather than failing visibly.
 */
export function clampPageSize(requested: number | string | undefined): number {
  if (requested === undefined) return DEFAULT_PAGE_SIZE;

  const parsed = typeof requested === 'string' ? Number.parseInt(requested, 10) : requested;
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;

  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_PAGE_SIZE);
}

/**
 * Builds a page from a query that deliberately fetched `limit + 1` rows.
 *
 * Fetching one extra row is how we learn whether another page exists without a
 * second `COUNT(*)` query.
 */
export function buildCursorPage<T>(
  rows: readonly T[],
  limit: number,
  encodeCursor: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    hasMore,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
  };
}

/**
 * Opaque cursor encoding.
 *
 * Cursors are base64url-encoded so clients treat them as opaque and we stay
 * free to change the payload. This is **not** a security boundary — never put
 * anything in a cursor a client may not see, and always re-authorize the
 * decoded values.
 */
export function encodeCursor(payload: Record<string, string | number>): string {
  return btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeCursor(cursor: string): Record<string, string | number> | null {
  try {
    const padded = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const parsed: unknown = JSON.parse(atob(padded));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, string | number>;
  } catch {
    return null;
  }
}
