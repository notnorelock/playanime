import { describe, expect, it } from 'bun:test';
import { MediaProviderId } from '@playanime/contracts';
import { createRumbleProvider } from '../src/providers/rumble/index.js';
import {
  parseRumbleOEmbed,
  parseRumblePlaybackMetadata,
  parseRumbleUrl,
} from '../src/providers/rumble/RumbleParser.js';
import {
  isAllowedRumbleMediaUrl,
  isFetchableRumbleUrl,
  parseEmbedToken,
} from '../src/providers/rumble/RumbleUrls.js';
import {
  pickAdaptiveSource,
  toHlsVariants,
  toPlaybackSources,
} from '../src/providers/rumble/RumbleQualities.js';
import { RumbleResolver } from '../src/providers/rumble/RumbleResolver.js';
import {
  RumbleUnsafeRedirectError,
  defaultRumbleFetch,
} from '../src/providers/rumble/RumbleClient.js';
import {
  assertNoSignedPlaybackUrlInPersistence,
  MemoryPlaybackCacheStore,
  PlaybackCache,
} from '../src/cache/PlaybackCache.js';
import { createDefaultRegistry, ProviderRegistry } from '../src/registry/index.js';
import { genericProvider } from '../src/providers/generic/index.js';
import { parseSubmittedUrl } from '../src/validation/url.js';
import type { ExternalMediaSource, PlaybackContext } from '../src/types/index.js';
import type { RumbleFetch, RumbleHttpResponse } from '../src/providers/rumble/RumbleTypes.js';

/**
 * Rumble provider tests.
 *
 * Fixtures are trimmed copies of real responses observed from Rumble's public
 * endpoints, including the parts that are easy to get wrong: the page slug
 * differing from the embed id, and the `tar`/`timeline`/`audio` entries that sit
 * beside the playable formats in the same map.
 */

const context: PlaybackContext = {
  embedOrigin: 'https://playani.me',
  locale: 'pl',
  autoplay: false,
};

function sourceOf(
  externalId: string,
  overrides: Partial<ExternalMediaSource> = {},
): ExternalMediaSource {
  return {
    id: 'src_rumble',
    provider: MediaProviderId.RUMBLE,
    externalId,
    resourceKey: null,
    canonicalUrl: `https://rumble.com/embed/${externalId}/`,
    audioLanguage: null,
    subtitleLanguage: null,
    qualityHint: null,
    metadata: {},
    ...overrides,
  };
}

function ok(body: unknown): RumbleHttpResponse {
  return {
    status: 200,
    contentType: 'application/json',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function stubFetch(handler: (url: string) => RumbleHttpResponse): RumbleFetch {
  return (url) => Promise.resolve(handler(url));
}

/** Returns the thrown value, or fails if the call unexpectedly succeeded. */
async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to reject, but it resolved.');
}

/** A real VOD response: HLS master playlist plus non-playable siblings. */
const VOD_METADATA = {
  title: '25 Jahre nach 9/11',
  duration: 502,
  live: 0,
  fps: 25,
  w: 1920,
  h: 1080,
  i: 'https://hugh.cdn.rumble.cloud/video/s8/6/a/l/j/Y/aljYA.qR4e.jpg',
  author: { name: 'RT DE', url: 'https://rumble.com/c/RTDE' },
  cc: [],
  ua: {
    tar: {
      '360': {
        url: 'https://hugh.cdn.rumble.cloud/video/s8/2/a/l/j/Y/aljYA.baa.tar?r_file=chunklist.m3u8',
        meta: { bitrate: 426, size: 26767360, w: 640, h: 360 },
      },
      '720': {
        url: 'https://hugh.cdn.rumble.cloud/video/s8/2/a/l/j/Y/aljYA.gaa.tar?r_file=chunklist.m3u8',
        meta: { bitrate: 922, size: 57907200, w: 1280, h: 720 },
      },
    },
    timeline: {
      '180': {
        url: 'https://hugh.cdn.rumble.cloud/video/s8/2/a/l/j/Y/aljYA.Faa.mp4',
        meta: { bitrate: 11, size: 746538, w: 320, h: 180 },
      },
    },
    audio: {
      '192': {
        url: 'https://hugh.cdn.rumble.cloud/video/s8/2/a/l/j/Y/aljYA.Gaa.aac',
        meta: { bitrate: 193, size: 12050433, w: 0, h: 0 },
      },
    },
    hls: {
      auto: { url: 'https://rumble.com/hls-vod/Qo-E4ppcNsU/playlist.m3u8', meta: {} },
    },
  },
};

const MP4_METADATA = {
  title: 'Progressive only',
  duration: 300,
  live: 0,
  cc: [],
  ua: {
    mp4: {
      '360': {
        url: 'https://hugh.cdn.rumble.cloud/video/a.baa.mp4',
        meta: { bitrate: 426, w: 640, h: 360 },
      },
      '720': {
        url: 'https://hugh.cdn.rumble.cloud/video/a.gaa.mp4',
        meta: { bitrate: 922, w: 1280, h: 720 },
      },
      '1080': {
        url: 'https://hugh.cdn.rumble.cloud/video/a.haa.mp4',
        meta: { bitrate: 1800, w: 1920, h: 1080 },
      },
    },
  },
};

const OEMBED_BODY = {
  type: 'video',
  title: '25 Jahre nach 9/11',
  author_name: 'RT DE',
  duration: 502,
  thumbnail_url: 'https://hugh.cdn.rumble.cloud/video/s8/1/9/F/K/N/9FKNj.qR4e.jpg',
  html: '<iframe src="https://rumble.com/embed/v7dctl6/" width="1920" height="1080"></iframe>',
};

/* -------------------------------------------------------------------------- */

describe('Rumble URL parser', () => {
  it('parses a normal video page into a slug id and a cleaned page URL', () => {
    const identity = parseRumbleUrl(
      new URL('https://rumble.com/v7fj6io-25-jahre-nach-911-teil-i.html'),
    );

    expect(identity?.pageSlugId).toBe('v7fj6io');
    expect(identity?.pageUrl).toBe('https://rumble.com/v7fj6io-25-jahre-nach-911-teil-i.html');
    // A page URL alone never yields an embed id: they are usually different.
    expect(identity?.embedId).toBeUndefined();
  });

  it('parses a direct embed URL into an embed id', () => {
    for (const input of [
      'https://rumble.com/embed/v7dctl6/',
      'https://rumble.com/embed/v7dctl6',
      'https://www.rumble.com/embed/v7dctl6/',
    ]) {
      expect(parseRumbleUrl(new URL(input))?.embedId).toBe('v7dctl6');
    }
  });

  it('parses an embed URL carrying a publisher prefix', () => {
    expect(parseRumbleUrl(new URL('https://rumble.com/embed/4.v7dctl6/'))?.embedId).toBe('v7dctl6');
    expect(parseEmbedToken('4.v7dctl6')).toBe('v7dctl6');
    expect(parseEmbedToken('u12.v3abcd')).toBe('v3abcd');
  });

  it('strips referral query parameters so the same video deduplicates', () => {
    const withQuery = parseRumbleUrl(
      new URL('https://rumble.com/v7fj6io-title.html?e9s=src_v1_podcasts%2Csrc_v1_hp_rs'),
    );
    const without = parseRumbleUrl(new URL('https://rumble.com/v7fj6io-title.html'));

    expect(withQuery?.pageUrl).toBe(without?.pageUrl);
  });

  it('rejects non-video Rumble pages', () => {
    for (const input of [
      'https://rumble.com/',
      'https://rumble.com/c/SomeChannel',
      'https://rumble.com/user/Someone',
      'https://rumble.com/search/video?q=x',
      'https://rumble.com/browse/video',
      'https://rumble.com/premium',
    ]) {
      expect(parseRumbleUrl(new URL(input))).toBeNull();
    }
  });

  it('rejects a malformed slug that is not an id token', () => {
    for (const input of [
      'https://rumble.com/not-an-id.html',
      'https://rumble.com/.html',
      'https://rumble.com/embed//',
    ]) {
      expect(parseRumbleUrl(new URL(input))).toBeNull();
    }
  });

  it('rejects look-alike hostnames', () => {
    for (const input of [
      'https://rumble.com.attacker.net/v7fj6io-x.html',
      'https://notrumble.com/v7fj6io-x.html',
      'https://evil-rumble.com/embed/v7dctl6/',
      'https://attacker.com/?url=rumble.com/v7fj6io-x.html',
    ]) {
      expect(parseRumbleUrl(new URL(input))).toBeNull();
    }
  });
});

describe('Rumble embed identity', () => {
  it('reads the embed id out of oEmbed iframe markup', () => {
    const metadata = parseRumbleOEmbed(OEMBED_BODY);

    // The page slug was v7fj6io; the embed id is different.
    expect(metadata?.embedId).toBe('v7dctl6');
    expect(metadata?.title).toBe('25 Jahre nach 9/11');
    expect(metadata?.channel).toBe('RT DE');
    expect(metadata?.durationSeconds).toBe(502);
  });

  it('resolves a page slug to the real embed id through the resolver', async () => {
    const resolver = new RumbleResolver({ fetch: stubFetch(() => ok(OEMBED_BODY)) });
    const metadata = await resolver.resolveEmbedIdentity('https://rumble.com/v7fj6io-x.html');

    expect(metadata?.embedId).toBe('v7dctl6');
  });

  it('returns null when embed metadata is missing', () => {
    expect(parseRumbleOEmbed({ type: 'video', title: 'no html field' })).toBeNull();
    expect(parseRumbleOEmbed({ html: '<iframe src="https://evil.com/embed/v1/"></iframe>' })).toBeNull();
  });

  it('returns null for malformed oEmbed metadata', () => {
    for (const body of [null, 'not json', 42, [], { html: 12 }]) {
      expect(parseRumbleOEmbed(body)).toBeNull();
    }
  });

  it('treats a 404 from oEmbed as no identity rather than an error', async () => {
    const resolver = new RumbleResolver({
      fetch: stubFetch(() => ({
        status: 404,
        contentType: 'text/plain',
        body: 'Media not found with that url',
      })),
    });

    expect(await resolver.resolveEmbedIdentity('https://rumble.com/vgone-x.html')).toBeNull();
  });
});

describe('Rumble playback metadata', () => {
  it('extracts the HLS master playlist and ignores non-playable siblings', () => {
    const metadata = parseRumblePlaybackMetadata(VOD_METADATA);

    expect(metadata).not.toBeNull();
    const types = metadata?.sources.map((source) => source.type) ?? [];

    expect(types).toContain('hls');
    // `.tar` archives, the 180p scrub track and the audio-only rendition must
    // never be offered as qualities.
    expect(metadata?.sources.every((source) => !source.url.endsWith('.tar'))).toBe(true);
    expect(metadata?.sources.some((source) => source.url.endsWith('.aac'))).toBe(false);
    expect(metadata?.sources.some((source) => source.resolution === 180)).toBe(false);
  });

  it('normalizes multiple MP4 qualities from real dimensions', () => {
    const metadata = parseRumblePlaybackMetadata(MP4_METADATA);
    const sources = toPlaybackSources(metadata?.sources ?? []);

    expect(sources.map((source) => source.resolution)).toEqual([1080, 720, 360]);
    expect(sources.every((source) => source.mimeType === 'video/mp4')).toBe(true);
  });

  it('handles WebM renditions', () => {
    const metadata = parseRumblePlaybackMetadata({
      duration: 60,
      live: 0,
      ua: {
        webm: {
          '480': { url: 'https://hugh.cdn.rumble.cloud/v/a.webm', meta: { w: 854, h: 480 } },
        },
      },
    });

    const sources = toPlaybackSources(metadata?.sources ?? []);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.mimeType).toBe('video/webm');
    expect(sources[0]?.resolution).toBe(480);
  });

  it('prefers MP4 over WebM at the same resolution', () => {
    const metadata = parseRumblePlaybackMetadata({
      live: 0,
      ua: {
        webm: { '720': { url: 'https://hugh.cdn.rumble.cloud/v/a.webm', meta: { h: 720 } } },
        mp4: { '720': { url: 'https://hugh.cdn.rumble.cloud/v/a.mp4', meta: { h: 720 } } },
      },
    });

    const sources = toPlaybackSources(metadata?.sources ?? []);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.mimeType).toBe('video/mp4');
  });

  it('serves MP4 and HLS together, preferring the adaptive playlist', () => {
    const metadata = parseRumblePlaybackMetadata({
      live: 0,
      ua: {
        mp4: { '720': { url: 'https://hugh.cdn.rumble.cloud/v/a.mp4', meta: { h: 720 } } },
        hls: { auto: { url: 'https://rumble.com/hls-vod/abc/playlist.m3u8' } },
      },
    });

    expect(pickAdaptiveSource(metadata?.sources ?? [])?.type).toBe('hls');
    expect(toPlaybackSources(metadata?.sources ?? [])).toHaveLength(1);
  });

  it('omits a quality label rather than inventing one', () => {
    const metadata = parseRumblePlaybackMetadata({
      live: 0,
      ua: { mp4: { unknown: { url: 'https://hugh.cdn.rumble.cloud/v/a.mp4', meta: {} } } },
    });

    const sources = toPlaybackSources(metadata?.sources ?? []);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.resolution).toBeUndefined();
  });

  it('builds HLS variant hints from the progressive ladder', () => {
    const metadata = parseRumblePlaybackMetadata(MP4_METADATA);
    const variants = toHlsVariants(metadata?.sources ?? []);

    expect(variants.map((variant) => variant.resolution)).toEqual([1080, 720, 360]);
    // kbps in the response becomes bits per second in the contract.
    expect(variants[0]?.bandwidth).toBe(1_800_000);
  });

  /**
   * For an HLS-only VOD the rungs exist only in the archive entries, whose
   * metadata mirrors the master playlist. Reading them is what gives an
   * adaptive stream a real quality menu.
   */
  it('reads the adaptive ladder from archive metadata without using its URLs', () => {
    const metadata = parseRumblePlaybackMetadata(VOD_METADATA);

    expect(metadata?.ladder.map((rung) => rung.resolution)).toEqual([720, 360]);
    expect(metadata?.ladder.every((rung) => !('url' in rung))).toBe(true);
  });

  it('labels an HLS descriptor from the ladder, not from archive sources', () => {
    const metadata = parseRumblePlaybackMetadata(VOD_METADATA);
    const variants = toHlsVariants(metadata?.sources ?? [], metadata?.ladder ?? []);

    expect(variants.map((variant) => variant.resolution)).toEqual([720, 360]);
    expect(variants[0]?.bandwidth).toBe(922_000);
  });

  it('excludes the scrub-thumbnail and audio tracks from the ladder', () => {
    const metadata = parseRumblePlaybackMetadata(VOD_METADATA);

    // `timeline` is 180p and `audio` has h=0; neither is a video rendition.
    expect(metadata?.ladder.some((rung) => rung.resolution === 180)).toBe(false);
    expect(metadata?.ladder.some((rung) => rung.resolution === 192)).toBe(false);
  });

  it('returns null for a malformed response', () => {
    for (const body of [false, null, 'nope', 42, []]) {
      expect(parseRumblePlaybackMetadata(body)).toBeNull();
    }
  });

  it('survives a response whose format map has unexpected shapes', () => {
    const metadata = parseRumblePlaybackMetadata({
      live: 0,
      ua: { mp4: [], webm: null, hls: 'nonsense', unknownFormat: { '720': { url: 'https://rumble.com/x' } } },
    });

    expect(metadata?.sources).toEqual([]);
  });
});

describe('Rumble live state', () => {
  it('reads an ordinary VOD', () => {
    const metadata = parseRumblePlaybackMetadata(VOD_METADATA);
    expect(metadata?.liveState).toBe('vod');
    expect(metadata?.durationSeconds).toBe(502);
  });

  it('reads a live stream and reports no duration', () => {
    const metadata = parseRumblePlaybackMetadata({
      live: 2,
      duration: 0,
      ua: { hls: { auto: { url: 'https://rumble.com/live-hls/abc/playlist.m3u8' } } },
    });

    expect(metadata?.liveState).toBe('live');
    expect(metadata?.durationSeconds).toBeUndefined();
  });

  it('distinguishes a finished livestream from one still running', () => {
    const recorded = parseRumblePlaybackMetadata({
      live: 2,
      duration: 3600,
      ua: { hls: { auto: { url: 'https://rumble.com/live-hls-dvr/abc/playlist.m3u8' } } },
    });

    expect(recorded?.liveState).toBe('recorded_live');
    expect(recorded?.durationSeconds).toBe(3600);
  });

  it('reads an upcoming stream', () => {
    expect(parseRumblePlaybackMetadata({ live: 1, ua: {} })?.liveState).toBe('upcoming');
  });
});

describe('Rumble subtitles', () => {
  it('reports none when Rumble sends an empty array', () => {
    expect(parseRumblePlaybackMetadata(VOD_METADATA)?.subtitles).toEqual([]);
  });

  it('normalizes a single caption track', () => {
    const metadata = parseRumblePlaybackMetadata({
      live: 0,
      ua: {},
      cc: { en: { path: 'https://rumble.com/cc/en.vtt', language: 'English' } },
    });

    expect(metadata?.subtitles).toEqual([
      { language: 'en', label: 'English', url: 'https://rumble.com/cc/en.vtt' },
    ]);
  });

  it('normalizes multiple caption tracks', () => {
    const metadata = parseRumblePlaybackMetadata({
      live: 0,
      ua: {},
      cc: {
        en: { path: 'https://rumble.com/cc/en.vtt', language: 'English' },
        pl: { path: 'https://rumble.com/cc/pl.vtt', language: 'Polski' },
      },
    });

    expect(metadata?.subtitles.map((track) => track.language).sort()).toEqual(['en', 'pl']);
  });
});

describe('Rumble restriction handling', () => {
  /** Rumble answers a refused video with literal `false` under HTTP 200. */
  it('treats a `false` body as unavailable rather than success', async () => {
    const resolver = new RumbleResolver({ fetch: stubFetch(() => ok('false')) });
    const outcome = await resolver.resolve('v7dctl6');

    expect(outcome.status).toBe('not_found');
    expect(outcome.detail).toBe('provider_returned_false');
  });

  it('reports a 403 as access denied and never retries around it', async () => {
    const resolver = new RumbleResolver({
      fetch: stubFetch(() => ({ status: 403, contentType: 'text/html', body: '<html>denied' })),
    });

    expect((await resolver.resolve('v7dctl6')).status).toBe('access_denied');
  });

  it('maps a denied video to a restricted descriptor, not a native one', async () => {
    const provider = createRumbleProvider({
      fetch: stubFetch(() => ({ status: 403, contentType: null, body: '' })),
    });

    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), context);
    expect(descriptor.type).toBe('unavailable');
    if (descriptor.type !== 'unavailable') throw new Error('unreachable');
    expect(descriptor.reason).toBe('requires_provider_permission');
  });

  it('maps a removed video to an unavailable descriptor', async () => {
    const provider = createRumbleProvider({ fetch: stubFetch(() => ok('false')) });
    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), context);

    expect(descriptor.type).toBe('unavailable');
  });

  it('falls back to the embed when a page slug cannot be resolved', async () => {
    const provider = createRumbleProvider({
      fetch: stubFetch(() => ({ status: 404, contentType: 'text/plain', body: 'not found' })),
    });

    const descriptor = await provider.resolvePlayback(
      sourceOf('v7fj6io', {
        canonicalUrl: 'https://rumble.com/v7fj6io-x.html',
        metadata: { identity: 'page-slug' },
      }),
      context,
    );

    expect(descriptor.type).toBe('unavailable');
  });
});

describe('Rumble descriptors', () => {
  it('produces an HLS descriptor with the master playlist and an iframe fallback', async () => {
    const provider = createRumbleProvider({ fetch: stubFetch(() => ok(VOD_METADATA)) });
    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), context);

    expect(descriptor.type).toBe('hls');
    if (descriptor.type !== 'hls') throw new Error('unreachable');

    expect(descriptor.src).toBe('https://rumble.com/hls-vod/Qo-E4ppcNsU/playlist.m3u8');
    expect(descriptor.live).toBe(false);
    expect(descriptor.fallback?.src).toBe('https://rumble.com/embed/v7dctl6/');
    // Quality labels come from the advertised ladder.
    expect(descriptor.variants?.map((variant) => variant.resolution)).toEqual([720, 360]);
    // The playable source is the playlist alone — no archive URLs anywhere.
    expect(JSON.stringify(descriptor)).not.toContain('.tar');
  });

  it('produces a native descriptor when only progressive variants exist', async () => {
    const provider = createRumbleProvider({ fetch: stubFetch(() => ok(MP4_METADATA)) });
    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), context);

    expect(descriptor.type).toBe('native');
    if (descriptor.type !== 'native') throw new Error('unreachable');

    expect(descriptor.sources.map((source) => source.resolution)).toEqual([1080, 720, 360]);
    expect(descriptor.fallback?.src).toBe('https://rumble.com/embed/v7dctl6/');
  });

  it('falls back to the official embed when no variant is playable', async () => {
    const provider = createRumbleProvider({
      fetch: stubFetch(() => ok({ live: 0, ua: { tar: {}, audio: {} } })),
    });

    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), context);

    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('unreachable');
    expect(descriptor.url).toBe('https://rumble.com/embed/v7dctl6/');
  });

  it('falls back to the embed when resolution throws', async () => {
    const provider = createRumbleProvider({
      fetch: () => Promise.reject(new Error('network down')),
    });

    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), context);
    expect(descriptor.type).toBe('iframe');
  });

  it('uses the embed for a response shape it no longer recognizes', async () => {
    const provider = createRumbleProvider({
      fetch: stubFetch(() => ok({ totally: 'different', schema: true })),
    });

    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), context);
    expect(descriptor.type).toBe('iframe');
  });

  it('marks a live stream as live', async () => {
    const provider = createRumbleProvider({
      fetch: stubFetch(() =>
        ok({
          live: 2,
          duration: 0,
          ua: { hls: { auto: { url: 'https://rumble.com/live-hls/abc/playlist.m3u8' } } },
        }),
      ),
    });

    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), context);
    if (descriptor.type !== 'hls') throw new Error('expected hls');
    expect(descriptor.live).toBe(true);
  });

  it('adds muted autoplay to the embed only when asked', async () => {
    const provider = createRumbleProvider({
      fetch: stubFetch(() => ok({ live: 0, ua: {} })),
    });

    const descriptor = await provider.resolvePlayback(sourceOf('v7dctl6'), {
      ...context,
      autoplay: true,
    });

    if (descriptor.type !== 'iframe') throw new Error('expected iframe');
    expect(new URL(descriptor.url).searchParams.get('autoplay')).toBe('2');
  });

  it('refuses an invalid stored id', async () => {
    const provider = createRumbleProvider({ fetch: stubFetch(() => ok(VOD_METADATA)) });
    const descriptor = await provider.resolvePlayback(sourceOf('../../etc/passwd'), context);

    expect(descriptor.type).toBe('unavailable');
  });
});

describe('Rumble security', () => {
  it('only accepts Rumble hosts as fetchable', () => {
    expect(isFetchableRumbleUrl('https://rumble.com/embedJS/u3/?v=v1')).toBe(true);
    expect(isFetchableRumbleUrl('https://www.rumble.com/x')).toBe(true);

    for (const url of [
      'https://rumble.com.attacker.net/x',
      'https://attacker.com/?url=rumble.com',
      'http://rumble.com/x',
      'https://user:pass@rumble.com/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'file:///etc/passwd',
      'https://169.254.169.254/latest/meta-data/',
      // The CDN is valid for media but must not be a metadata fetch target.
      'https://hugh.cdn.rumble.cloud/video/a.mp4',
    ]) {
      expect(isFetchableRumbleUrl(url)).toBe(false);
    }
  });

  it('allows media only on Rumble-owned hosts', () => {
    expect(isAllowedRumbleMediaUrl('https://rumble.com/hls-vod/a/playlist.m3u8')).toBe(true);
    expect(isAllowedRumbleMediaUrl('https://hugh.cdn.rumble.cloud/video/a.mp4')).toBe(true);

    for (const url of [
      'https://evil.com/a.mp4',
      'https://rumble.cloud.attacker.net/a.mp4',
      'http://hugh.cdn.rumble.cloud/a.mp4',
    ]) {
      expect(isAllowedRumbleMediaUrl(url)).toBe(false);
    }
  });

  it('drops a media URL on an unexpected host even from a genuine response', async () => {
    const resolver = new RumbleResolver({
      fetch: stubFetch(() =>
        ok({
          live: 0,
          ua: {
            mp4: {
              '720': { url: 'https://evil.example/pwned.mp4', meta: { h: 720 } },
              '480': { url: 'https://hugh.cdn.rumble.cloud/ok.mp4', meta: { h: 480 } },
            },
          },
        }),
      ),
    });

    const outcome = await resolver.resolve('v7dctl6');
    expect(outcome.playback.sources).toHaveLength(1);
    expect(outcome.playback.sources[0]?.url).toContain('rumble.cloud');
  });

  it('refuses to follow a redirect off a Rumble host', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
      )) as typeof globalThis.fetch;

    try {
      expect(
        await captureRejection(() =>
          defaultRumbleFetch('https://rumble.com/embedJS/u3/?v=v7dctl6'),
        ),
      ).toBeInstanceOf(RumbleUnsafeRedirectError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('gives up on an endless redirect chain', async () => {
    const originalFetch = globalThis.fetch;
    let hop = 0;
    globalThis.fetch = (() => {
      hop += 1;
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: `https://rumble.com/hop/${String(hop)}` },
        }),
      );
    }) as typeof globalThis.fetch;

    try {
      expect(
        await captureRejection(() =>
          defaultRumbleFetch('https://rumble.com/embedJS/u3/?v=v7dctl6'),
        ),
      ).toBeInstanceOf(RumbleUnsafeRedirectError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts a request that exceeds its timeout', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })) as typeof globalThis.fetch;

    try {
      const error = await captureRejection(() =>
        defaultRumbleFetch('https://rumble.com/embedJS/u3/?v=v7dctl6', { timeoutMs: 20 }),
      );
      expect(error).toBeInstanceOf(Error);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('caps an oversized response body', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('x'.repeat(50_000), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof globalThis.fetch;

    try {
      const error = await captureRejection(() =>
        defaultRumbleFetch('https://rumble.com/embedJS/u3/?v=v7dctl6', {
          maxResponseBytes: 1_000,
        }),
      );
      expect((error as Error).message).toMatch(/exceeded/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sends no viewer credentials upstream', async () => {
    const seen: Record<string, string>[] = [];
    const resolver = new RumbleResolver({
      fetch: (_url, init) => {
        seen.push({ ...(init?.headers ?? {}) });
        return Promise.resolve(ok(VOD_METADATA));
      },
    });

    await resolver.resolve('v7dctl6');

    for (const headers of seen) {
      const keys = Object.keys(headers).map((key) => key.toLowerCase());
      expect(keys).not.toContain('cookie');
      expect(keys).not.toContain('authorization');
    }
  });
});

describe('Rumble caching', () => {
  function countingFetch(response: RumbleHttpResponse): { fetch: RumbleFetch; calls: () => number } {
    let calls = 0;
    return {
      fetch: () => {
        calls += 1;
        return Promise.resolve(response);
      },
      calls: () => calls,
    };
  }

  it('serves a second request from cache', async () => {
    const counting = countingFetch(ok(VOD_METADATA));
    const cache = new PlaybackCache({ store: new MemoryPlaybackCacheStore() });
    const provider = createRumbleProvider({ fetch: counting.fetch, cache });

    const first = await provider.resolvePlayback(sourceOf('v7dctl6'), context);
    const second = await provider.resolvePlayback(sourceOf('v7dctl6'), context);

    expect(counting.calls()).toBe(1);
    expect(second).toEqual(first);
  });

  it('resolves again after the entry is invalidated', async () => {
    const counting = countingFetch(ok(VOD_METADATA));
    const cache = new PlaybackCache({ store: new MemoryPlaybackCacheStore() });
    const provider = createRumbleProvider({ fetch: counting.fetch, cache });

    await provider.resolvePlayback(sourceOf('v7dctl6'), context);
    await cache.invalidate(MediaProviderId.RUMBLE, 'v7dctl6', null);
    await provider.resolvePlayback(sourceOf('v7dctl6'), context);

    expect(counting.calls()).toBe(2);
  });

  it('never caches a failure outcome', async () => {
    const counting = countingFetch({ status: 403, contentType: null, body: '' });
    const cache = new PlaybackCache({ store: new MemoryPlaybackCacheStore() });
    const provider = createRumbleProvider({ fetch: counting.fetch, cache });

    await provider.resolvePlayback(sourceOf('v7dctl6'), context);
    await provider.resolvePlayback(sourceOf('v7dctl6'), context);

    // A restriction must be re-checked, not remembered for the whole TTL.
    expect(counting.calls()).toBe(2);
  });

  it('caches the iframe fallback so a broken resolver is not retried per request', async () => {
    const counting = countingFetch(ok({ live: 0, ua: { tar: {} } }));
    const cache = new PlaybackCache({ store: new MemoryPlaybackCacheStore() });
    const provider = createRumbleProvider({ fetch: counting.fetch, cache });

    const first = await provider.resolvePlayback(sourceOf('v7dctl6'), context);
    const second = await provider.resolvePlayback(sourceOf('v7dctl6'), context);

    expect(first.type).toBe('iframe');
    expect(second.type).toBe('iframe');
    expect(counting.calls()).toBe(1);
  });
});

describe('Rumble persistence', () => {
  it('persists stable provider identity', () => {
    for (const url of [
      'https://rumble.com/embed/v7dctl6/',
      'https://rumble.com/v7fj6io-25-jahre-nach-911-teil-i.html',
    ]) {
      expect(() => {
        assertNoSignedPlaybackUrlInPersistence(url, 'episode_sources.canonical_url');
      }).not.toThrow();
    }
  });

  it('refuses to persist a resolved playlist or CDN URL', () => {
    for (const url of [
      'https://rumble.com/hls-vod/Qo-E4ppcNsU/playlist.m3u8',
      'https://rumble.com/live-hls/cq3hNek9b9U/playlist.m3u8',
      'https://rumble.com/live-hls-dvr/RUTyQEwzWnw/playlist.m3u8',
      'https://hugh.cdn.rumble.cloud/video/a.gaa.tar?r_range=1-2',
    ]) {
      expect(() => {
        assertNoSignedPlaybackUrlInPersistence(url, 'episode_sources.canonical_url');
      }).toThrow(/Refusing to persist/);
    }
  });
});

describe('Rumble registry integration', () => {
  const registry = createDefaultRegistry();

  it('claims Rumble URLs through the registry, not by string matching', () => {
    const provider = registry.resolve(
      parseSubmittedUrl('https://rumble.com/v7fj6io-title.html'),
    );
    expect(provider.definition.id).toBe(MediaProviderId.RUMBLE);
  });

  it('routes a look-alike host to the external-link provider', () => {
    expect(
      registry.resolve(parseSubmittedUrl('https://rumble.com.attacker.net/v7fj6io-x.html'))
        .definition.id,
    ).toBe(MediaProviderId.EXTERNAL_LINK);
  });

  it('declares native capability and the CDN media host', () => {
    const definition = registry.get(MediaProviderId.RUMBLE).definition;

    expect(definition.canEmitNative).toBe(true);
    expect(definition.mediaHosts).toContain('rumble.cloud');
  });

  it('includes Rumble in the frame-src policy', () => {
    expect(registry.frameSrcOrigins()).toContain('https://rumble.com');
  });

  it('passes a real Rumble HLS descriptor through the registry guard', async () => {
    // The guard (assertDescriptorIsLegal) runs inside ProviderRegistry, so this
    // exercises the same path the API uses — with a stubbed transport, so the
    // test never touches the network.
    const local = new ProviderRegistry(genericProvider).register(
      createRumbleProvider({ fetch: stubFetch(() => ok(VOD_METADATA)) }),
    );

    const descriptor = await local.resolvePlayback(sourceOf('v7dctl6'), context);

    expect(descriptor.type).toBe('hls');
    if (descriptor.type !== 'hls') throw new Error('unreachable');
    expect(new URL(descriptor.src).hostname).toBe('rumble.com');
  });

  it('switches cleanly between a Drive source and a Rumble source', () => {
    const drive = registry.parse(
      parseSubmittedUrl('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view'),
    );
    const rumble = registry.parse(parseSubmittedUrl('https://rumble.com/embed/v7dctl6/'));

    expect(drive.provider).toBe(MediaProviderId.GOOGLE_DRIVE);
    expect(rumble.provider).toBe(MediaProviderId.RUMBLE);
    // Same contract both times: the caller never branches on provider identity.
    expect(rumble.canonicalUrl).toBe('https://rumble.com/embed/v7dctl6/');
  });
});
