import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  CdaApi,
  CdaResolver,
  buildCdaLinkRequest,
  parseCdaLinkResponse,
  parseCdaPlayerData,
  extractCdaVideoId,
  cdaStream,
  createCdaProvider,
  cdaDefinition,
} from '../src/providers/cda/index.js';
import { MemoryPlaybackCacheStore, PlaybackCache } from '../src/cache/PlaybackCache.js';
import { assertDescriptorIsLegal } from '../src/validation/descriptor.js';
import { createDefaultRegistry } from '../src/registry/default-registry.js';
import type { CdaFetch, CdaPlayerData } from '../src/providers/cda/index.js';
import type { ExternalMediaSource, PlaybackContext } from '../src/types/index.js';

const fixture = readFileSync(new URL('./fixtures/cda-player.html', import.meta.url), 'utf8');
const videoId = '12345abc';
const pageUrl = `https://www.cda.pl/video/${videoId}`;
const context: PlaybackContext = { embedOrigin: 'https://playani.me', locale: 'pl', autoplay: false };
const source: ExternalMediaSource = {
  id: 'source-id',
  provider: 'cda',
  externalId: videoId,
  canonicalUrl: pageUrl,
  resourceKey: null,
  audioLanguage: null,
  subtitleLanguage: null,
  qualityHint: null,
  metadata: {},
};

function requestBody(init: RequestInit): string {
  if (typeof init.body !== 'string') throw new Error('Expected a JSON request body');
  return init.body;
}

async function expectFailure(promise: Promise<unknown>, reason: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(reason);
}

/** Build synthetic variants without embedding provider credentials in tests. */
function page(video: Partial<CdaPlayerData['video']>): string {
  const data = parseCdaPlayerData(fixture, videoId);
  data.video = { ...data.video, ...video };
  return `<div player_data="${JSON.stringify(data).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></div>`;
}

function rpc(id: number, url: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result: { status: 'ok', resp: url } });
}

function transport(html = fixture, extension = 'm3u8'): CdaFetch {
  return (url, init) => {
    if (url === pageUrl) return Promise.resolve(new Response(html));
    const request = JSON.parse(requestBody(init)) as { id: number; params: [string, string] };
    return Promise.resolve(
      new Response(rpc(request.id, `https://media.example/${request.params[1]}/index.${extension}`)),
    );
  };
}

describe('CDA identity and player data', () => {
  it('recognizes exact video URLs, existing embed URLs and internal raw IDs', () => {
    for (const input of [
      pageUrl,
      `https://cda.pl/video/${videoId}?x=1`,
      `https://ebd.cda.pl/640x360/${videoId}`,
      videoId,
    ]) {
      expect(extractCdaVideoId(input)).toBe(videoId);
    }
    const parsed = createDefaultRegistry().parse(new URL(pageUrl));
    expect(parsed.externalId).toBe(videoId);
    expect(parsed.canonicalUrl).toBe(pageUrl);
    expect(parsed.metadata).toBeUndefined();
  });

  it('rejects unrelated paths, lookalike hosts, credentials and extra segments', () => {
    for (const input of [
      'https://cda.pl/',
      'https://cda.pl/user/test',
      `https://cda.pl/video/${videoId}/extra`,
      `https://cda.pl/a/video/${videoId}`,
      `https://cda.pl.evil.example/video/${videoId}`,
      `https://other.cda.pl/video/${videoId}`,
      `https://user@cda.pl/video/${videoId}`,
      `https://cda.pl:123/video/${videoId}`,
      `https://ebd.cda.pl/user/${videoId}`,
      `file://cda.pl/video/${videoId}`,
    ]) {
      expect(extractCdaVideoId(input)).toBeNull();
    }
  });

  it('decodes entities, dynamic qualities and protocol-relative thumbnails', () => {
    const data = parseCdaPlayerData(fixture, videoId);
    expect(data.video.title).toBe("Test & Anime 'episode'");
    expect(data.video.file).toBe('https://media.example/480/index.m3u8?token=fixture&part=1');
    expect(data.video.thumb).toBe('https://images.example/thumbnail.jpg');
    expect(data.video.qualities?.['1440p']).toBe('new-quality');
    expect(data.api?.key).toBe('not-the-token');
  });

  it('distinguishes absent data from malformed or mismatched player data', () => {
    expect(() => parseCdaPlayerData('<script>player_data="{}"</script>', videoId)).toThrow(
      'CDA_PLAYER_DATA_NOT_FOUND',
    );
    for (const html of [
      '<div player_data="{broken}"></div>',
      '<div player_data="null"></div>',
      page({ id: 'other-id' }),
      page({ qualities: { '720p': 123 } as unknown as Record<string, string> }),
    ]) {
      expect(() => parseCdaPlayerData(html, videoId)).toThrow('CDA_PLAYER_DATA_INVALID');
    }
  });

  it('classifies stream paths and preserves new labels without guessing a height', () => {
    expect(cdaStream('//new-cdn.example/x.m3u8?x=.mp4', '1440p')).toMatchObject({
      type: 'hls',
      resolution: 1440,
    });
    expect(cdaStream('https://media.example/x.mpd')?.type).toBe('dash');
    expect(cdaStream('https://media.example/x.mp4', 'original')?.resolution).toBeUndefined();
    expect(cdaStream('https://media.example/no-extension')).toBeUndefined();
    for (const url of [
      'http://media.example/x.mp4',
      'https://127.0.0.1/x.mp4',
      'https://[::1]/x.mp4',
      'https://user:secret@media.example/x.mp4',
      'https://host.internal/x.mp4',
    ]) {
      expect(cdaStream(url)).toBeUndefined();
    }
  });
});

describe('CDA JSON-RPC', () => {
  it('accepts the string request ID echoed by the live CDA endpoint', () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: '3',
      result: { status: 'ok', resp: 'https://media.example/video.mp4' },
    });

    expect(parseCdaLinkResponse(body, 3)).toBe('https://media.example/video.mp4');
    expect(() => parseCdaLinkResponse(body, 4)).toThrow('CDA_API_ERROR');
  });

  it('uses video.ts and the unchanged hash2, never api.key or video.hash', async () => {
    const data = parseCdaPlayerData(fixture, videoId);
    expect(buildCdaLinkRequest(data.video, 'new-quality', 3)).toEqual({
      jsonrpc: '2.0',
      method: 'videoGetLink',
      params: [videoId, 'new-quality', 1800000000, 'opaque-fixture-token', {}],
      id: 3,
    });
    const calls: { url: string; init: RequestInit }[] = [];
    const api = new CdaApi({
      fetch: (url, init) => {
        calls.push({ url, init });
        return Promise.resolve(new Response(rpc(3, '//media.example/1440.mp4')));
      },
    });
    expect(await api.videoGetLink(data.video, 'new-quality', 3)).toBe('https://media.example/1440.mp4');
    expect(calls[0]?.url).toBe(`${pageUrl}/vjs`);
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: pageUrl },
    });
  });

  it('rejects invalid RPC responses and unadvertised quality requests', () => {
    for (const body of [
      'invalid',
      '{}',
      rpc(99, 'https://media.example/x.mp4'),
      JSON.stringify({ jsonrpc: '2.0', id: 3, error: { message: 'private-secret' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, result: { status: 'fail', resp: 'secret' } }),
    ]) {
      expect(() => parseCdaLinkResponse(body, 3)).toThrow('CDA_');
    }
    expect(() =>
      buildCdaLinkRequest(parseCdaPlayerData(fixture, videoId).video, 'not-advertised', 1),
    ).toThrow('CDA_QUALITY_RESOLVE_FAILED');
  });

  it('does not follow redirects, expose transport errors, or accept oversized bodies', async () => {
    for (const response of [
      new Response('', { status: 302 }),
      new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    ]) {
      await expectFailure(
        new CdaApi({ fetch: () => Promise.resolve(response) }).fetchPage(videoId),
        'CDA_PAGE_FETCH_FAILED',
      );
    }
    const api = new CdaApi({ fetch: () => Promise.reject(new Error('sensitive upstream token')) });
    await expectFailure(api.fetchPage(videoId), 'CDA_PAGE_FETCH_FAILED');
  });
});

describe('CDA resolution and descriptors', () => {
  it('rejects unsafe URLs in every HLS source at the descriptor boundary', () => {
    expect(() =>
      assertDescriptorIsLegal(
        {
          type: 'hls',
          provider: 'cda',
          src: 'https://media.example/720.m3u8',
          sources: [{ src: 'https://foo.localhost/360.m3u8' }],
        },
        cdaDefinition,
      ),
    ).toThrow('unsafe media URL');
  });

  it('uses only stable identity, ignoring stored stream URLs and page overrides', async () => {
    const requested: string[] = [];
    const baseFetch = transport();
    await createCdaProvider({
      fetch: (url, init) => {
        requested.push(url);
        return baseFetch(url, init);
      },
    }).resolvePlayback(
      {
        ...source,
        canonicalUrl: 'https://attacker.example/',
        metadata: { file: 'https://attacker.example/video.mp4', hash2: 'wrong-token' },
      },
      context,
    );
    expect(requested.every((url) => url === pageUrl || url === `${pageUrl}/vjs`)).toBe(true);
  });

  it('passes typed failures to API callers that enable throwOnHardFailure', async () => {
    const provider = createCdaProvider({
      throwOnHardFailure: true,
      fetch: () => Promise.resolve(new Response('<html></html>')),
    });
    await expectFailure(
      Promise.resolve(provider.resolvePlayback(source, context)),
      'CDA_PLAYER_DATA_NOT_FOUND',
    );
  });

  it('caps cache TTL at one minute or before explicit stream expiry', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const ttls: number[] = [];
    const cache = new PlaybackCache({
      now: () => now,
      store: {
        get: () => Promise.resolve(null),
        del: () => Promise.resolve(),
        set: (_key, _value, ttl) => {
          ttls.push(ttl);
          return Promise.resolve();
        },
      },
    });
    await createCdaProvider({ now: () => now, cache, fetch: transport() }).resolvePlayback(source, context);
    const expires = Math.floor(now.getTime() / 1000) + 20;
    await createCdaProvider({
      now: () => now,
      cache,
      fetch: transport(
        page({ qualities: {}, file: `https://media.example/x.mp4?expires=${String(expires)}` }),
      ),
    }).resolvePlayback(source, context);
    expect(ttls).toEqual([60, 19]);
  });

  it('resolves every dynamic quality and retains successful optional qualities', async () => {
    const requests: string[] = [];
    const warnings: string[] = [];
    const result = await new CdaResolver({
      fetch: (url, init) => {
        if (url === pageUrl) return Promise.resolve(new Response(fixture));
        const request = JSON.parse(requestBody(init)) as { id: number; params: [string, string] };
        requests.push(request.params[1]);
        return Promise.resolve(
          new Response(
            request.params[1] === 'vl'
              ? '{}'
              : rpc(request.id, `https://new-cdn.example/${request.params[1]}.m3u8`),
          ),
        );
      },
      logger: {
        info: () => undefined,
        error: () => undefined,
        warn: (message) => {
          warnings.push(message);
        },
      },
    }).resolve(videoId);
    expect(requests.sort()).toEqual(['lq', 'new-quality', 'vl']);
    expect(warnings).toHaveLength(1);
    expect(result.sources.some((stream) => stream.quality === '1440p')).toBe(true);
    expect(result.sources.some((stream) => stream.url.includes('cast.example'))).toBe(false);
    expect(result.duration).toBe(1420);
    expect(result.thumbnail).toBe('https://images.example/thumbnail.jpg');
  });

  it('limits concurrent quality requests to four', async () => {
    let active = 0;
    let peak = 0;
    const qualities = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`${String(i + 1)}p`, `q${String(i)}`]),
    );
    await new CdaResolver({
      fetch: async (url, init) => {
        if (url === pageUrl) return new Response(page({ qualities }));
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        const request = JSON.parse(requestBody(init)) as { id: number };
        return new Response(rpc(request.id, `https://media.example/${String(request.id)}.mp4`));
      },
    }).resolve(videoId);
    expect(peak).toBe(4);
  });

  it('returns HLS playlists through the existing descriptor validation', async () => {
    const descriptor = await createCdaProvider({ fetch: transport() }).resolvePlayback(source, context);
    expect(descriptor.type).toBe('hls');
    expect(assertDescriptorIsLegal(descriptor, cdaDefinition)).toBe(descriptor);
    if (descriptor.type !== 'hls') throw new Error('Expected HLS');
    expect(descriptor.sources?.some((stream) => stream.resolution === 1440)).toBe(true);
    expect(descriptor.variants).toBeUndefined();
  });

  it('uses MP4 natively, leaves DASH off-site, and never promotes cast-only URLs', async () => {
    const mp4 = await createCdaProvider({ fetch: transport(page({ file: null }), 'mp4') }).resolvePlayback(
      source,
      context,
    );
    expect(mp4.type).toBe('native');
    const dash = await createCdaProvider({
      fetch: transport(page({ file: 'https://media.example/x.mpd', qualities: {} })),
    }).resolvePlayback(source, context);
    expect(dash.type).toBe('external');
    await expectFailure(
      new CdaResolver({ fetch: transport(page({ file: null, qualities: {} })) }).resolve(videoId),
      'CDA_VIDEO_UNAVAILABLE',
    );
  });

  it('honors the player disabling quality changes and uses its direct source', async () => {
    let calls = 0;
    const descriptor = await createCdaProvider({
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response(page({ quality_change_in_player: false })));
      },
    }).resolvePlayback(source, context);
    expect(calls).toBe(1);
    expect(descriptor.type).toBe('hls');
  });

  it('returns access failures without attempting another page or bypass', async () => {
    let calls = 0;
    const provider = createCdaProvider({
      fetch: () => {
        calls += 1;
        return Promise.resolve(new Response('', { status: 403 }));
      },
    });
    expect(await provider.resolvePlayback(source, context)).toMatchObject({
      type: 'unavailable',
      reason: 'requires_provider_permission',
      fallbackUrl: pageUrl,
    });
    expect(calls).toBe(1);
  });

  it('caches briefly and resolves fresh tokens after invalidation', async () => {
    let pageCalls = 0;
    const store = new MemoryPlaybackCacheStore();
    const cache = new PlaybackCache({ store });
    const baseFetch = transport();
    const provider = createCdaProvider({
      cache,
      fetch: (url, init) => {
        if (url === pageUrl) pageCalls += 1;
        return baseFetch(url, init);
      },
    });
    await provider.resolvePlayback(source, context);
    await provider.resolvePlayback(source, context);
    expect(pageCalls).toBe(1);
    await cache.invalidate('cda', videoId, null);
    await provider.resolvePlayback(source, context);
    expect(pageCalls).toBe(2);
  });

  it('caps expiry conservatively and discards already-expired streams', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const expires = Math.floor(now.getTime() / 1000) + 30;
    const result = await new CdaResolver({
      now: () => now,
      fetch: transport(
        page({ qualities: {}, file: `https://media.example/x.mp4?expires=${String(expires)}` }),
      ),
    }).resolve(videoId);
    expect(result.expiresAt.getTime()).toBe(expires * 1000);
    await expectFailure(
      new CdaResolver({
        now: () => now,
        fetch: transport(page({ qualities: {}, file: 'https://media.example/x.mp4?expires=1' })),
      }).resolve(videoId),
      'CDA_VIDEO_UNAVAILABLE',
    );
  });
});
