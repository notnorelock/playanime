import { afterEach, describe, expect, it } from 'bun:test';
import { fetchImageMeta } from '../src/image-meta.js';

/**
 * A real, valid 4x4 red PNG (not a fake/mocked byte buffer) — `sharp`
 * decodes actual image bytes, so a test double that just returns garbage
 * would only ever exercise the error path, never prove the real
 * decode+encode pipeline works. Generated with `sharp` itself
 * (`sharp({ create: {...} }).png().toBuffer()`) rather than hand-written,
 * since a hand-crafted PNG's checksums are easy to get subtly wrong in a
 * way that passes a lenient metadata read but fails strict pixel decoding.
 */
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4z8AARwgWXg4ArpMP8bh5W0YAAAAASUVORK5CYII=';

function pngResponse(): Response {
  const bytes = Uint8Array.from(atob(VALID_PNG_BASE64), (c) => c.charCodeAt(0));
  return new Response(bytes, { status: 200 });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchImageMeta', () => {
  it('returns real width/height and a blurhash for a decodable image', async () => {
    globalThis.fetch = (() => Promise.resolve(pngResponse())) as typeof fetch;

    const result = await fetchImageMeta('https://example.com/cover.png');

    expect(result).not.toBeNull();
    expect(result?.width).toBe(4);
    expect(result?.height).toBe(4);
    expect(typeof result?.blurhash).toBe('string');
    expect(result?.blurhash.length).toBeGreaterThan(0);
  });

  it('returns null when the fetch itself fails', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('network error'))) as typeof fetch;

    const result = await fetchImageMeta('https://example.com/cover.png');
    expect(result).toBeNull();
  });

  it('returns null on a non-2xx response', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch;

    const result = await fetchImageMeta('https://example.com/missing.png');
    expect(result).toBeNull();
  });

  it('returns null when the response body is not a decodable image', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('not an image', { status: 200 }))) as typeof fetch;

    const result = await fetchImageMeta('https://example.com/not-an-image.png');
    expect(result).toBeNull();
  });
});
