import { describe, expect, it } from 'bun:test';
import { MediaProviderId } from '@playanime/contracts';
import { createDefaultRegistry } from '../src/registry/index.js';
import { assertDescriptorIsLegal } from '../src/validation/descriptor.js';
import { parseSubmittedUrl } from '../src/validation/url.js';
import { parseByseUrl } from '../src/providers/byse/ByseParser.js';
import { buildByseEmbedPlayerUrl } from '../src/providers/byse/ByseEmbed.js';
import {
  ByseEmbedHostAllowlist,
  buildByseEmbedUrl,
  isByseFileCode,
  isByseSourceHost,
} from '../src/providers/byse/ByseUrls.js';
import { createByseProvider } from '../src/providers/byse/ByseProvider.js';
import { MemoryPlaybackCacheStore, PlaybackCache } from '../src/cache/PlaybackCache.js';
import type { ByseKeyValueCache } from '../src/providers/byse/ByseTypes.js';
import type { ExternalMediaSource, PlaybackContext } from '../src/types/index.js';

const registry = createDefaultRegistry();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
}

/**
 * Builds a real, `decryptBysePlayback`-decryptable envelope for a given
 * plain payload, using the exact same AES-GCM scheme production traffic
 * uses — no `version` field, so `selectPlaybackKeyParts` uses the single
 * key part supplied as the whole key, the simplest valid case. Used to
 * exercise the real decrypt path in tests rather than mocking it away.
 */
async function encryptBysePlayback(
  payload: Record<string, unknown>,
): Promise<{ key_parts: string[]; iv: string; payload: string }> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  return {
    key_parts: [base64UrlEncode(keyBytes)],
    iv: base64UrlEncode(iv),
    payload: base64UrlEncode(new Uint8Array(encrypted)),
  };
}

const context: PlaybackContext = {
  embedOrigin: 'https://playani.me',
  locale: 'pl',
  autoplay: false,
};

function sourceFrom(url: string): ExternalMediaSource {
  const parsed = registry.parse(parseSubmittedUrl(url));
  return {
    id: 'src_1',
    provider: parsed.provider,
    externalId: parsed.externalId,
    resourceKey: parsed.resourceKey ?? null,
    canonicalUrl: parsed.canonicalUrl,
    audioLanguage: null,
    subtitleLanguage: null,
    qualityHint: null,
    metadata: {},
  };
}

/* -------------------------------------------------------------------------- */
/* §22 URL parser tests                                                       */
/* -------------------------------------------------------------------------- */

describe('Byse URL parser', () => {
  it('extracts the file code from /e/<fileCode>', () => {
    const code = parseByseUrl(new URL('https://bysedikamoum.com/e/0n9agffcf4oc'));
    expect(code).toBe('0n9agffcf4oc');
  });

  it('extracts the file code from /download/<fileCode>, ignoring the slug', () => {
    expect(
      parseByseUrl(new URL('https://bysedikamoum.com/download/xch2ympylj8c')),
    ).toBe('xch2ympylj8c');
    expect(
      parseByseUrl(new URL('https://bysedikamoum.com/download/xch2ympylj8c/solo-leveling-01')),
    ).toBe('xch2ympylj8c');
  });

  it('two download URLs for the same code normalize to the same identity regardless of slug', () => {
    const a = registry.parse(
      parseSubmittedUrl('https://bysedikamoum.com/download/xch2ympylj8c/solo-leveling-01'),
    );
    const b = registry.parse(
      parseSubmittedUrl('https://bysedikamoum.com/download/xch2ympylj8c/some-other-title'),
    );

    expect(a.provider).toBe(MediaProviderId.BYSE);
    expect(a.externalId).toBe('xch2ympylj8c');
    expect(a.canonicalUrl).toBe(b.canonicalUrl);
  });

  it('recognizes every "byse"-branded domain, not only one static host', () => {
    const hosts = ['byse.sx', 'api.byse.sx', 'bysedikamoum.com', 'byse-mirror.example'];
    for (const host of hosts) {
      expect(isByseSourceHost(host)).toBe(true);
    }
  });

  it('does not recognize a host where "byse" is not the registrable label', () => {
    const hosts = ['notbyse.com', 'mybyse.evil.com', 'evil.com', 'bys.com'];
    for (const host of hosts) {
      expect(isByseSourceHost(host)).toBe(false);
    }
  });

  it('handles a query string and a trailing slash', () => {
    expect(
      parseByseUrl(new URL('https://bysedikamoum.com/e/0n9agffcf4oc/?ref=share')),
    ).toBe('0n9agffcf4oc');
    expect(parseByseUrl(new URL('https://bysedikamoum.com/e/0n9agffcf4oc/'))).toBe(
      '0n9agffcf4oc',
    );
  });

  it('rejects an invalid or empty file code', () => {
    expect(parseByseUrl(new URL('https://bysedikamoum.com/e/'))).toBeNull();
    expect(parseByseUrl(new URL('https://bysedikamoum.com/e/has space'))).toBeNull();
    expect(parseByseUrl(new URL('https://bysedikamoum.com/e/a'))).toBeNull();
  });

  it('rejects an unsupported hostname', () => {
    expect(parseByseUrl(new URL('https://example.com/e/0n9agffcf4oc'))).toBeNull();
  });

  it('rejects a malformed path shape', () => {
    expect(parseByseUrl(new URL('https://bysedikamoum.com/'))).toBeNull();
    expect(parseByseUrl(new URL('https://bysedikamoum.com/watch/0n9agffcf4oc'))).toBeNull();
  });

  it('routes an unsupported hostname to the external-link fallback via the registry', () => {
    const parsed = registry.parse(parseSubmittedUrl('https://example.com/e/0n9agffcf4oc'));
    expect(parsed.provider).toBe(MediaProviderId.EXTERNAL_LINK);
  });

  it('duplicate imports of the same source deduplicate to one identity', () => {
    const a = registry.parse(parseSubmittedUrl('https://bysedikamoum.com/e/0n9agffcf4oc'));
    const b = registry.parse(
      parseSubmittedUrl('https://api.byse.sx/e/0n9agffcf4oc'),
    );
    expect(a.externalId).toBe(b.externalId);
  });

  it('isByseFileCode accepts the documented token shape and rejects garbage', () => {
    expect(isByseFileCode('xch2ympylj8c')).toBe(true);
    expect(isByseFileCode('0n9agffcf4oc')).toBe(true);
    expect(isByseFileCode('')).toBe(false);
    expect(isByseFileCode('has space')).toBe(false);
    expect(isByseFileCode('a')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* §24 Embed URL builder tests                                                */
/* -------------------------------------------------------------------------- */

describe('Byse embed URL builder', () => {
  it('builds the plain documented embed URL from a file code', () => {
    expect(buildByseEmbedUrl('abc123')).toBe('https://api.byse.sx/e/abc123');
  });

  it('refuses to build a URL from an invalid file code', () => {
    expect(() => buildByseEmbedUrl('has space')).toThrow();
  });

  it('adds autoplay only when requested', () => {
    const withoutAutoplay = new URL(buildByseEmbedPlayerUrl('abc123'));
    expect(withoutAutoplay.searchParams.has('autoplay')).toBe(false);

    const withAutoplay = new URL(buildByseEmbedPlayerUrl('abc123', undefined, { autoplay: true }));
    expect(withAutoplay.searchParams.get('autoplay')).toBe('1');
  });

  it('encodes remote subtitle pairs in order, matching cX_file/cX_label', () => {
    const url = new URL(
      buildByseEmbedPlayerUrl('abc123', undefined, {
        subtitles: [
          { url: 'https://example.com/pl.vtt', label: 'Polski' },
          { url: 'https://example.com/en.vtt', label: 'English' },
        ],
      }),
    );

    expect(url.searchParams.get('c1_file')).toBe('https://example.com/pl.vtt');
    expect(url.searchParams.get('c1_label')).toBe('Polski');
    expect(url.searchParams.get('c2_file')).toBe('https://example.com/en.vtt');
    expect(url.searchParams.get('c2_label')).toBe('English');
  });

  it('correctly encodes a subtitle URL and label containing special characters', () => {
    const url = new URL(
      buildByseEmbedPlayerUrl('abc123', undefined, {
        subtitles: [{ url: 'https://example.com/a b&c.vtt?x=1&y=2', label: 'Español & Français' }],
      }),
    );

    // Semantic equality via URLSearchParams, not string comparison — the
    // runtime's own encoding is authoritative.
    expect(url.searchParams.get('c1_file')).toBe('https://example.com/a b&c.vtt?x=1&y=2');
    expect(url.searchParams.get('c1_label')).toBe('Español & Français');
    // No duplicated/malformed parameters: exactly one value per key.
    expect(url.searchParams.getAll('c1_file')).toHaveLength(1);
  });

  it('drops a non-https subtitle URL rather than emitting it', () => {
    const url = new URL(
      buildByseEmbedPlayerUrl('abc123', undefined, {
        subtitles: [{ url: 'http://example.com/insecure.vtt', label: 'Insecure' }],
      }),
    );

    expect(url.searchParams.has('c1_file')).toBe(false);
  });

  it('adds a poster only when it is a valid https URL', () => {
    const withPoster = new URL(
      buildByseEmbedPlayerUrl('abc123', undefined, { posterUrl: 'https://playani.me/poster.jpg' }),
    );
    expect(withPoster.searchParams.get('poster')).toBe('https://playani.me/poster.jpg');

    const withInsecurePoster = new URL(
      buildByseEmbedPlayerUrl('abc123', undefined, { posterUrl: 'http://playani.me/poster.jpg' }),
    );
    expect(withInsecurePoster.searchParams.has('poster')).toBe(false);
  });

  it('adds a logo only when configured', () => {
    const withoutLogo = new URL(buildByseEmbedPlayerUrl('abc123'));
    expect(withoutLogo.searchParams.has('logo')).toBe(false);

    const withLogo = new URL(
      buildByseEmbedPlayerUrl('abc123', undefined, { logoUrl: 'https://playani.me/logo.png' }),
    );
    expect(withLogo.searchParams.get('logo')).toBe('https://playani.me/logo.png');
  });

  it('combines subtitle, poster and logo parameters without collision', () => {
    const url = new URL(
      buildByseEmbedPlayerUrl('abc123', undefined, {
        subtitles: [{ url: 'https://example.com/pl.vtt', label: 'Polski' }],
        posterUrl: 'https://playani.me/poster.jpg',
        logoUrl: 'https://playani.me/logo.png',
      }),
    );

    expect(url.pathname).toBe('/e/abc123');
    expect(url.searchParams.get('c1_file')).toBe('https://example.com/pl.vtt');
    expect(url.searchParams.get('poster')).toBe('https://playani.me/poster.jpg');
    expect(url.searchParams.get('logo')).toBe('https://playani.me/logo.png');
  });
});

/* -------------------------------------------------------------------------- */
/* Descriptor / registry integration                                          */
/* -------------------------------------------------------------------------- */

describe('Byse provider descriptor', () => {
  it('resolves to a documented iframe descriptor', async () => {
    const descriptor = await registry.resolvePlayback(
      sourceFrom('https://bysedikamoum.com/e/xch2ympylj8c'),
      context,
    );

    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('unreachable');
    expect(descriptor.provider).toBe(MediaProviderId.BYSE);
    expect(new URL(descriptor.url).pathname).toBe('/e/xch2ympylj8c');
    expect(descriptor.requiresSameOrigin).toBe(true);
  });

  it('is embeddable and may emit native playback (opt-in — see the "Byse with nativePlayback enabled" suite)', () => {
    expect(registry.canEmbed(MediaProviderId.BYSE)).toBe(true);
    expect(registry.get(MediaProviderId.BYSE).definition.canEmitNative).toBe(true);
  });

  it('passes assertDescriptorIsLegal for the default documented embed host', async () => {
    const descriptor = await registry.resolvePlayback(
      sourceFrom('https://bysedikamoum.com/e/xch2ympylj8c'),
      context,
    );
    expect(() =>
      assertDescriptorIsLegal(descriptor, registry.get(MediaProviderId.BYSE).definition),
    ).not.toThrow();
  });

  /**
   * Regression coverage for a real production failure: a resolved native
   * descriptor's source CDN host (e.g. edge1-madrid-sprintcdn.<random>.com)
   * has no fixed naming pattern, so `isMediaUrlAllowed` must exist and must
   * be wired to the same dynamic allowlist `isEmbedUrlAllowed` already
   * uses — see security.test.ts's "Byse-shaped" suite for the validator-
   * level proof; this only checks that the real provider actually defines
   * the hook at all, which is what was missing.
   */
  it('defines isMediaUrlAllowed, not just isEmbedUrlAllowed', () => {
    const provider = createByseProvider({ apiKey: 'k' });
    expect(typeof provider.definition.isMediaUrlAllowed).toBe('function');
    // A host nothing has resolved/learned yet must not be trusted by default.
    expect(provider.definition.isMediaUrlAllowed?.('https://evil.example/master.m3u8')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* §25 API-key behavior tests                                                 */
/* -------------------------------------------------------------------------- */

describe('Byse without BYSE_API_KEY', () => {
  it('plays via the documented default embed without any key', async () => {
    const provider = createByseProvider();
    const descriptor = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);

    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('unreachable');
    expect(descriptor.url).toBe('https://api.byse.sx/e/xch2ympylj8c');
  });

  it('never calls the API client when no key is configured', async () => {
    let called = false;
    const provider = createByseProvider({
      fetch: (() => {
        called = true;
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    });

    await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);
    const availability = await provider.checkAvailability?.(sourceFrom_local(provider, 'xch2ympylj8c'));

    expect(called).toBe(false);
    expect(availability?.status).toBe('unknown');
  });

  it('a failed /get/domain lookup is not fatal and falls back to the documented default', async () => {
    const provider = createByseProvider({
      apiKey: 'k',
      fetch: (() => Promise.reject(new Error('network down'))),
    });

    const descriptor = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);
    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('unreachable');
    expect(new URL(descriptor.url).hostname).toBe('api.byse.sx');
  });
});

describe('Byse with BYSE_API_KEY', () => {
  it('resolves the embed domain through /get/domain and uses it', async () => {
    const provider = createByseProvider({
      apiKey: 'k',
      fetch: ((url: string) => {
        expect(url).toContain('/get/domain');
        expect(url).toContain('key=k');
        return Promise.resolve(
          jsonResponse({
            embed_domain: 'blablabla_embed_domain.com',
            status: 200,
            server_time: '2026-01-01T00:00:00Z',
          }),
        );
      }),
    });

    const descriptor = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);
    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('unreachable');
    expect(new URL(descriptor.url).hostname).toBe('blablabla_embed_domain.com');

    // The resolved domain was learned, so the descriptor built from it passes
    // the provider's own iframe-legality check.
    expect(() =>
      assertDescriptorIsLegal(descriptor, provider.definition),
    ).not.toThrow();
  });

  it('uses /file/info for source health and marks canplay=0 as unavailable', async () => {
    const provider = createByseProvider({
      apiKey: 'k',
      fetch: ((url: string) => {
        if (url.includes('/file/info')) {
          return Promise.resolve(
            jsonResponse({
              status: 200,
              result: [{ status: 200, file_code: 'xch2ympylj8c', canplay: 0, file_title: 'solo-leveling-01' }],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ status: 404 }));
      }),
    });

    const descriptor = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);
    expect(descriptor.type).toBe('unavailable');
  });

  it('reports checkAvailability from /file/info', async () => {
    const provider = createByseProvider({
      apiKey: 'k',
      fetch: (() =>
        Promise.resolve(
          jsonResponse({ status: 200, result: [{ status: 200, file_code: 'xch2ympylj8c', canplay: 1 }] }),
        )),
    });

    const availability = await provider.checkAvailability?.(sourceFrom_local(provider, 'xch2ympylj8c'));
    expect(availability?.status).toBe('available');
  });

  it('keeps the API key out of the built embed URL', async () => {
    const provider = createByseProvider({
      apiKey: 'super-secret-key',
      fetch: (() =>
        Promise.resolve(
          jsonResponse({ embed_domain: 'byse-cdn.example', status: 200 }),
        )),
    });

    const descriptor = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);
    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('unreachable');
    expect(descriptor.url).not.toContain('super-secret-key');
  });
});

/* -------------------------------------------------------------------------- */
/* Native playback (nativePlayback option)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every test in this block passes `unsafeForceEnableNativePlaybackInTests`
 * alongside `nativePlayback` — see `isNativePlaybackForceDisabled`'s doc
 * comment in ByseProvider.ts. Native/hls playback is currently force-
 * disabled in `resolvePlayback()` regardless of `nativePlayback`
 * configuration (confirmed live: a Byse-signed source URL is bound to the
 * network context of whichever server requested it, so it never plays in
 * the end viewer's own browser). The resolve/decrypt/classify pipeline
 * itself is unchanged and still correct — only the one call that would act
 * on its result is skipped in production — so these tests still exercise
 * it directly via the escape hatch rather than being deleted.
 */
describe('Byse with nativePlayback enabled', () => {
  /**
   * Regression coverage for a real production failure: the /playback
   * fingerprint body included `expires_at`, which Byse's server rejects
   * with 400 "invalid request body" — confirmed by reading the actual
   * client bundle. This pins the exact request shapes so a future change
   * cannot silently reintroduce that mismatch.
   */
  it('sends the exact /access/attest and /playback request shapes the real client sends', async () => {
    const requests: { url: string; body: unknown }[] = [];

    const provider = createByseProvider({
      apiKey: 'k',
      nativePlayback: { attestDevice: true },
      unsafeForceEnableNativePlaybackInTests: true,
      fetch: ((url: string, init?: RequestInit) => {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        requests.push({ url, body });

        if (url.includes('/get/domain')) {
          return Promise.resolve(jsonResponse({ embed_domain: 'byseqekaho.com', status: 200 }));
        }
        if (url.includes('/embed/details')) {
          return Promise.resolve(jsonResponse({ description: '', owner_private: false }));
        }
        if (url.includes('/embed/settings')) {
          return Promise.resolve(jsonResponse({ captcha_required: false }));
        }
        if (url.includes('/access/challenge')) {
          return Promise.resolve(jsonResponse({ challenge_id: 'chal_1', nonce: 'nonce_1' }));
        }
        if (url.includes('/access/attest')) {
          return Promise.resolve(
            jsonResponse({
              viewer_id: 'viewer_1',
              device_id: 'device_1',
              token: 'attest_token',
              confidence: 'low',
              expires_at: '2026-01-08T00:00:00Z',
            }),
          );
        }
        if (url.includes('/embed/playback')) {
          // No sources: resolution falls back to the iframe either way —
          // this test only cares about the request shapes above.
          return Promise.resolve(jsonResponse({ playback: null, skip_intro: null }));
        }
        return Promise.resolve(jsonResponse({ status: 404 }));
      }),
    });

    await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);

    const challengeRequest = requests.find((r) => r.url.includes('/access/challenge'));
    expect(challengeRequest?.body).toBeUndefined();

    const attestRequest = requests.find((r) => r.url.includes('/access/attest'));
    expect(attestRequest).toBeDefined();
    expect(attestRequest?.body).toMatchObject({
      viewer_id: '',
      device_id: '',
      challenge_id: 'chal_1',
      nonce: 'nonce_1',
      client: {},
      storage: {},
      attributes: { entropy: 'low' },
    });
    expect(attestRequest?.body).toHaveProperty('signature');
    expect(attestRequest?.body).toHaveProperty('public_key');
    // client only ever carries user_agent (+ canvas_hash when rendering
    // succeeds) — never a browser-only signal this server cannot observe.
    const clientField = (attestRequest?.body as { client?: Record<string, unknown> } | undefined)?.client;
    expect(Object.keys(clientField ?? {}).every((key) => key === 'user_agent' || key === 'canvas_hash')).toBe(
      true,
    );

    const playbackRequest = requests.find((r) => r.url.includes('/embed/playback'));
    expect(playbackRequest?.body).toEqual({
      fingerprint: {
        viewer_id: 'viewer_1',
        device_id: 'device_1',
        token: 'attest_token',
        confidence: 'low',
      },
    });
    // expires_at is part of the cached identity, never the /playback body —
    // Byse's server 400s ("invalid request body") if it is present here.
    expect(playbackRequest?.body).not.toHaveProperty('fingerprint.expires_at');
  });

  /**
   * Regression coverage for the real production failure that followed the
   * fingerprint-shape fix: the first /playback attempt returned
   * 428 {"error":"captcha_required"}, and that was being classified as
   * BYSE_API_UNAVAILABLE and immediately falling back to the iframe —
   * skipping the captcha-refresh-and-retry path entirely. This pins that
   * exactly one retry happens, with a freshly solved captcha token, and
   * that native playback succeeds once the retry gets a real response.
   */
  it('retries /playback exactly once with a fresh captcha token on 428 captcha_required', async () => {
    const playbackAttempts: { hasCaptchaToken: boolean }[] = [];
    let attestCount = 0;
    let powStartCount = 0;
    let powVerifyCount = 0;

    const provider = createByseProvider({
      apiKey: 'k',
      nativePlayback: { attestDevice: true, autoSolvePowCaptcha: true },
      unsafeForceEnableNativePlaybackInTests: true,
      fetch: ((url: string, init?: RequestInit) => {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        const headers = new Headers(init?.headers);

        if (url.includes('/get/domain')) {
          return Promise.resolve(jsonResponse({ embed_domain: 'byseqekaho.com', status: 200 }));
        }
        if (url.includes('/embed/details')) {
          return Promise.resolve(jsonResponse({ description: '', owner_private: false }));
        }
        if (url.includes('/embed/settings')) {
          // Deliberately says no captcha is required — the real production
          // case had settings disagree with what /playback actually
          // demanded, and that must not stop the retry from happening.
          return Promise.resolve(jsonResponse({ captcha_required: false }));
        }
        if (url.includes('/access/challenge')) {
          return Promise.resolve(jsonResponse({ challenge_id: 'chal_1', nonce: 'nonce_1' }));
        }
        if (url.includes('/access/attest')) {
          attestCount += 1;
          return Promise.resolve(
            jsonResponse({
              viewer_id: 'viewer_1',
              device_id: 'device_1',
              token: 'attest_token',
              confidence: 'low',
              expires_at: '2026-01-08T00:00:00Z',
            }),
          );
        }
        if (url.includes('/embed/captcha/verify')) {
          powVerifyCount += 1;
          return Promise.resolve(jsonResponse({ status: 'ok', token: 'fresh-captcha-token' }));
        }
        if (url.includes('/embed/captcha')) {
          powStartCount += 1;
          // difficulty 0: solveBysePow resolves immediately with "0", so
          // this test stays fast and deterministic.
          return Promise.resolve(jsonResponse({ pow_nonce: 'n', pow_difficulty: 0, pow_token: 'pow_1' }));
        }
        if (url.includes('/embed/playback')) {
          const hasCaptchaToken = headers.has('X-Captcha-Token');
          playbackAttempts.push({ hasCaptchaToken });

          if (!hasCaptchaToken) {
            return Promise.resolve(
              new Response(JSON.stringify({ error: 'captcha_required' }), {
                status: 428,
                headers: { 'content-type': 'application/json' },
              }),
            );
          }

          // The retry: succeeds now that a captcha token is attached.
          return Promise.resolve(jsonResponse({ playback: null, skip_intro: null }));
        }
        return Promise.resolve(jsonResponse({ status: 404 }));
      }) as unknown as (url: string, init?: RequestInit) => Promise<Response>,
    });

    const descriptor = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);

    // Attested once (the cached identity is reused across both attempts,
    // never re-attested just because the captcha was refreshed).
    expect(attestCount).toBe(1);

    // Exactly two /playback attempts: the first (no captcha token, 428) and
    // the retry (fresh token attached) — never a third.
    expect(playbackAttempts).toEqual([{ hasCaptchaToken: false }, { hasCaptchaToken: true }]);

    // The captcha itself was solved exactly once for the retry.
    expect(powStartCount).toBe(1);
    expect(powVerifyCount).toBe(1);

    // No sources in the mocked response, so this still falls back to the
    // iframe — but it must be the *ordinary* iframe fallback (no error),
    // proving the whole retry sequence ran to completion successfully
    // rather than aborting after the first 428.
    expect(descriptor.type).toBe('iframe');
  });

  /**
   * Regression coverage for a real bug: Byse's decrypted playback response
   * is an HLS master playlist (confirmed live — a `master.m3u8` on a
   * SprintCDN host), but the descriptor built from it was unconditionally
   * `type: 'native'`, which only plays an `.m3u8` directly in Safari — every
   * other browser needs hls.js driving it via `type: 'hls'`. Exercises the
   * real AES-GCM decrypt path (not mocked) so a change to the crypto layer
   * or the classification logic both stay covered by the same test.
   */
  it('classifies a decrypted .m3u8 source as hls, not native, and carries tracks through', async () => {
    const encrypted = await encryptBysePlayback({
      sources: [
        {
          url: 'https://edge1-madrid-sprintcdn.r66nv9ed.com/hls2/x/master.m3u8?t=abc&e=10800',
          mime_type: 'application/vnd.apple.mpegurl',
        },
      ],
      tracks: [{ url: 'https://edge1-madrid-sprintcdn.r66nv9ed.com/subs/en.vtt', language: 'en', title: 'English' }],
    });

    const provider = createByseProvider({
      apiKey: 'k',
      nativePlayback: {},
      unsafeForceEnableNativePlaybackInTests: true,
      fetch: ((url: string) => {
        if (url.includes('/get/domain')) {
          return Promise.resolve(jsonResponse({ embed_domain: 'byseqekaho.com', status: 200 }));
        }
        if (url.includes('/embed/details')) {
          return Promise.resolve(jsonResponse({ description: '', owner_private: false }));
        }
        if (url.includes('/embed/settings')) {
          return Promise.resolve(jsonResponse({ captcha_required: false }));
        }
        if (url.includes('/embed/playback')) {
          return Promise.resolve(jsonResponse({ playback: encrypted, skip_intro: null }));
        }
        return Promise.resolve(jsonResponse({ status: 404 }));
      }) as unknown as (url: string, init?: RequestInit) => Promise<Response>,
    });

    const descriptor = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);

    expect(descriptor.type).toBe('hls');
    if (descriptor.type !== 'hls') throw new Error('unreachable');
    expect(descriptor.src).toContain('master.m3u8');
    expect(descriptor.tracks).toEqual([{ src: 'https://edge1-madrid-sprintcdn.r66nv9ed.com/subs/en.vtt', language: 'en', label: 'English' }]);
    expect(descriptor.fallback?.type).toBe('iframe');

    // The SprintCDN host has no fixed naming pattern and is never in the
    // provider's static hosts list — this is only legal because
    // isMediaUrlAllowed learned it from this same decrypted response.
    expect(() => assertDescriptorIsLegal(descriptor, provider.definition)).not.toThrow();
  });

  /**
   * The actual production behavior right now: `nativePlayback` configured
   * (as it is in the real deployment, via BYSE_NATIVE_PLAYBACK_ENABLED),
   * but WITHOUT `unsafeForceEnableNativePlaybackInTests` — proving
   * `isNativePlaybackForceDisabled` actually takes effect rather than only
   * being documented. A decryptable .m3u8 response is provided (the same
   * fixture as the "classifies... as hls" test above) specifically so this
   * test cannot pass by accident — if the force-disable ever stopped
   * working, this would return `hls`, not `iframe`.
   */
  it('returns the iframe even with a fully decryptable native response, per isNativePlaybackForceDisabled', async () => {
    const encrypted = await encryptBysePlayback({
      sources: [
        {
          url: 'https://edge1-madrid-sprintcdn.r66nv9ed.com/hls2/x/master.m3u8?t=abc&e=10800',
          mime_type: 'application/vnd.apple.mpegurl',
        },
      ],
    });

    const provider = createByseProvider({
      apiKey: 'k',
      nativePlayback: {},
      fetch: ((url: string) => {
        if (url.includes('/get/domain')) {
          return Promise.resolve(jsonResponse({ embed_domain: 'byseqekaho.com', status: 200 }));
        }
        if (url.includes('/embed/details')) {
          return Promise.resolve(jsonResponse({ description: '', owner_private: false }));
        }
        if (url.includes('/embed/settings')) {
          return Promise.resolve(jsonResponse({ captcha_required: false }));
        }
        if (url.includes('/embed/playback')) {
          return Promise.resolve(jsonResponse({ playback: encrypted, skip_intro: null }));
        }
        return Promise.resolve(jsonResponse({ status: 404 }));
      }) as unknown as (url: string, init?: RequestInit) => Promise<Response>,
    });

    const descriptor = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);

    expect(descriptor.type).toBe('iframe');
  });
});

/* -------------------------------------------------------------------------- */
/* Caching                                                                    */
/* -------------------------------------------------------------------------- */

describe('Byse caching', () => {
  it('caches the resolved playback descriptor', async () => {
    const store = new MemoryPlaybackCacheStore();
    const cache = new PlaybackCache({ store });
    const provider = createByseProvider({ playbackCache: cache });

    const first = await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);
    const cached = await cache.get(MediaProviderId.BYSE, 'xch2ympylj8c', null);

    expect(cached).not.toBeNull();
    expect(cached).toEqual(first);
  });

  /**
   * Regression coverage for a real production failure:
   * "Provider byse produced an unsafe media URL." `assertDescriptorIsLegal`
   * runs unconditionally on every `resolvePlayback` result, cached or not
   * (registry.ts), but `isCachedDescriptorStillValid` never re-learned a
   * cached native/hls descriptor's source/track/fallback hosts into a
   * fresh (post-restart) allowlist before returning it — so a descriptor
   * cached by one process instance failed validation when served by
   * another. Simulated here with two separate provider instances (a fresh,
   * empty allowlist each — exactly what a process restart produces)
   * sharing one playback-cache store, matching how this actually manifested
   * live rather than only unit-testing `isCachedDescriptorStillValid` in
   * isolation.
   */
  it('re-validates a cached hls descriptor against a fresh (post-restart) allowlist without throwing', async () => {
    const encrypted = await encryptBysePlayback({
      sources: [
        {
          url: 'https://edge1-madrid-sprintcdn.r66nv9ed.com/hls2/x/master.m3u8?t=abc&e=10800',
          mime_type: 'application/vnd.apple.mpegurl',
        },
      ],
      tracks: [{ url: 'https://edge1-madrid-sprintcdn.r66nv9ed.com/subs/en.vtt', language: 'en', title: 'English' }],
    });

    const store = new MemoryPlaybackCacheStore();
    const cache = new PlaybackCache({ store });
    const fetchImpl = ((url: string) => {
      if (url.includes('/get/domain')) {
        return Promise.resolve(jsonResponse({ embed_domain: 'byseqekaho.com', status: 200 }));
      }
      if (url.includes('/embed/details')) {
        return Promise.resolve(jsonResponse({ description: '', owner_private: false }));
      }
      if (url.includes('/embed/settings')) {
        return Promise.resolve(jsonResponse({ captcha_required: false }));
      }
      if (url.includes('/embed/playback')) {
        return Promise.resolve(jsonResponse({ playback: encrypted, skip_intro: null }));
      }
      return Promise.resolve(jsonResponse({ status: 404 }));
    }) as unknown as (url: string, init?: RequestInit) => Promise<Response>;

    // First "process": resolves and caches the hls descriptor. Its own
    // allowlist has learned the SprintCDN host by the time this returns.
    const providerA = createByseProvider({
      apiKey: 'k',
      nativePlayback: {},
      unsafeForceEnableNativePlaybackInTests: true,
      playbackCache: cache,
      fetch: fetchImpl,
    });
    const first = await providerA.resolvePlayback(sourceFrom_local(providerA, 'xch2ympylj8c'), context);
    expect(first.type).toBe('hls');

    // Second "process": a brand-new provider instance, own empty allowlist
    // (exactly what a restart produces), sharing the same cache store —
    // so this call is served from cache, never re-decrypting anything.
    const providerB = createByseProvider({
      apiKey: 'k',
      nativePlayback: {},
      unsafeForceEnableNativePlaybackInTests: true,
      playbackCache: cache,
      fetch: fetchImpl,
    });

    const second = await providerB.resolvePlayback(sourceFrom_local(providerB, 'xch2ympylj8c'), context);

    expect(second).toEqual(first);
    expect(() => assertDescriptorIsLegal(second, providerB.definition)).not.toThrow();
  });

  it('caches the resolved embed domain rather than looking it up on every call', async () => {
    let domainCalls = 0;
    const kvCache = memoryKvCache();
    const provider = createByseProvider({
      apiKey: 'k',
      cache: kvCache,
      fetch: ((url: string) => {
        if (url.includes('/get/domain')) {
          domainCalls += 1;
          return Promise.resolve(
            jsonResponse({ embed_domain: 'byse-cdn.example', status: 200 }),
          );
        }
        // /file/info: distinct fetch, exercised once per resolvePlayback call
        // regardless of domain caching, so it is not part of this assertion.
        return Promise.resolve(jsonResponse({ status: 200, result: [{ status: 200, canplay: 1 }] }));
      }),
    });

    await provider.resolvePlayback(sourceFrom_local(provider, 'aaa111'), context);
    await provider.resolvePlayback(sourceFrom_local(provider, 'bbb222'), context);

    expect(domainCalls).toBe(1);
  });

  it('namespaces its cache keys so two environments never collide on one Redis instance', async () => {
    const kvCache = memoryKvCache();
    const provider = createByseProvider({
      apiKey: 'k',
      cache: kvCache,
      namespace: 'staging',
      fetch: (() =>
        Promise.resolve(
          jsonResponse({ embed_domain: 'byse-cdn.example', status: 200 }),
        )),
    });

    await provider.resolvePlayback(sourceFrom_local(provider, 'xch2ympylj8c'), context);
    expect(await kvCache.get('staging:external-media:byse:domain')).toBe('byse-cdn.example');
    expect(await kvCache.get('playanime:external-media:byse:domain')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Security                                                                   */
/* -------------------------------------------------------------------------- */

describe('Byse embed host allowlist', () => {
  it('always allows the documented default host', () => {
    const allowlist = new ByseEmbedHostAllowlist();
    expect(allowlist.isAllowed('api.byse.sx')).toBe(true);
  });

  it('does not allow an arbitrary host until it has been learned', () => {
    const allowlist = new ByseEmbedHostAllowlist();
    expect(allowlist.isAllowed('evil.example')).toBe(false);
  });

  it('allows a host once learned, including one with no "byse" prefix', () => {
    const allowlist = new ByseEmbedHostAllowlist();
    allowlist.learn('blablabla_embed_domain.com');
    expect(allowlist.isAllowed('blablabla_embed_domain.com')).toBe(true);
  });

  it('never allows a host purely by naming convention', () => {
    const allowlist = new ByseEmbedHostAllowlist();
    // "byse"-prefixed, but never returned by a trusted /get/domain lookup.
    expect(allowlist.isAllowed('byse-attacker.example')).toBe(false);
  });
});

describe('Byse security', () => {
  it('rejects an iframe descriptor on an unresolved host', () => {
    const definition = createByseProvider().definition;
    expect(() =>
      assertDescriptorIsLegal(
        {
          type: 'iframe',
          provider: MediaProviderId.BYSE,
          url: 'https://evil.example/e/xch2ympylj8c',
          allow: '',
          requiresSameOrigin: true,
        },
        definition,
      ),
    ).toThrow();
  });

  it('does not claim a Byse look-alike hostname as a source', () => {
    const lookalikes = ['https://notbyse.com/e/abc123', 'https://mybyse.evil.com/e/abc123'];
    for (const url of lookalikes) {
      expect(registry.resolve(parseSubmittedUrl(url)).definition.id).toBe(
        MediaProviderId.EXTERNAL_LINK,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sourceFrom_local(
  provider: { parse(url: URL): { provider: string; externalId: string; canonicalUrl: string } | null },
  fileCode: string,
): ExternalMediaSource {
  const parsed = provider.parse(new URL(`https://api.byse.sx/e/${fileCode}`));
  if (parsed === null) throw new Error('expected a parsed Byse source');
  return {
    id: 'src_1',
    provider: MediaProviderId.BYSE,
    externalId: parsed.externalId,
    resourceKey: null,
    canonicalUrl: parsed.canonicalUrl,
    audioLanguage: null,
    subtitleLanguage: null,
    qualityHint: null,
    metadata: {},
  };
}

function memoryKvCache(): ByseKeyValueCache & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
    del: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}
