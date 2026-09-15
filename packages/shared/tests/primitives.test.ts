import { describe, expect, it } from 'bun:test';
import { slugify, truncate } from '../src/text/index.js';
import { buildCursorPage, clampPageSize, decodeCursor, encodeCursor, MAX_PAGE_SIZE } from '../src/pagination/index.js';
import { formatRuntime } from '../src/time/index.js';
import { isUuid, newToken, newUuid } from '../src/ids/index.js';

describe('slugify', () => {
  it('strips diacritics from Polish titles', () => {
    expect(slugify('Zabójcza Łódź Świętego Źrebaka')).toBe('zabojcza-lodz-swietego-zrebaka');
  });

  it('handles the stroked L that NFD does not decompose', () => {
    expect(slugify('Łowca')).toBe('lowca');
  });

  it('collapses punctuation and trims separators', () => {
    expect(slugify('  Fullmetal Alchemist: Brotherhood!  ')).toBe('fullmetal-alchemist-brotherhood');
  });

  it('transliterates Japanese-romanized titles unchanged', () => {
    expect(slugify('Shingeki no Kyojin')).toBe('shingeki-no-kyojin');
  });
});

describe('truncate', () => {
  it('leaves short input untouched', () => {
    expect(truncate('short', 20)).toBe('short');
  });

  it('cuts on a word boundary', () => {
    expect(truncate('the quick brown fox jumps', 16)).toBe('the quick brown…');
  });
});

describe('pagination', () => {
  it('clamps page size into range', () => {
    expect(clampPageSize(undefined)).toBe(24);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(9_999)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(Number.NaN)).toBe(24);
  });

  it('round-trips an opaque cursor', () => {
    const payload = { id: 'abc', rank: 42 };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('returns null for a malformed cursor', () => {
    expect(decodeCursor('not-base64!!')).toBeNull();
  });

  it('detects a further page from the sentinel row', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = buildCursorPage(rows, 2, (row) => row.id);

    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('b');
  });

  it('reports the final page', () => {
    const page = buildCursorPage([{ id: 'a' }], 2, (row) => row.id);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});

describe('formatRuntime', () => {
  it('formats sub-hour runtimes as M:SS', () => {
    expect(formatRuntime(1_434)).toBe('23:54');
  });

  it('formats long runtimes as H:MM:SS', () => {
    expect(formatRuntime(7_384)).toBe('2:03:04');
  });

  it('floors negatives to zero', () => {
    expect(formatRuntime(-5)).toBe('0:00');
  });
});

describe('ids', () => {
  it('generates valid v4 uuids', () => {
    expect(isUuid(newUuid())).toBe(true);
  });

  it('generates url-safe tokens without padding', () => {
    const token = newToken(32);
    expect(token).not.toContain('=');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
