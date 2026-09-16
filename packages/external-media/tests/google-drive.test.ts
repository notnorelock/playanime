import { describe, expect, it } from 'bun:test';
import {
  extractGoogleDriveFileId,
  parseGoogleDriveUrl,
  parsePlaybackApiBody,
  parseVideoInfoBody,
  parseViewerHtml,
  resolutionFromItag,
  sortAndDedupeVariants,
  highestResolution,
  isKnownItag,
  parseExpireParam,
  earliestExpiration,
  cacheTtlSeconds,
  isExpired,
  isLikelySignedPlaybackUrl,
  createGoogleDriveProvider,
  GoogleDriveResolver,
  PlaybackCache,
  MemoryPlaybackCacheStore,
  assertNoSignedPlaybackUrlInPersistence,
} from '../src/index.js';
import type { GoogleDriveFetch, GoogleDriveHttpResponse } from '../src/providers/google-drive/GoogleDriveTypes.js';
import type { ExternalMediaSource, PlaybackContext } from '../src/types/index.js';
import { MediaProviderId } from '@playanime/contracts';

const FILE_ID = '0ByeS4oOUV-49Zzh4R1J6R09zazQ';
const context: PlaybackContext = {
  embedOrigin: 'https://playani.me',
  locale: 'pl',
  autoplay: false,
};

function source(fileId = FILE_ID, resourceKey: string | null = null): ExternalMediaSource {
  return {
    id: 'src_1',
    provider: MediaProviderId.GOOGLE_DRIVE,
    externalId: fileId,
    resourceKey,
    canonicalUrl: `https://drive.google.com/file/d/${fileId}/view`,
    audioLanguage: null,
    subtitleLanguage: null,
    qualityHint: null,
    metadata: {},
  };
}

function signedUrl(itag: number, expire: number, resolutionHost = 'rr5---sn-xxxx.c.drive.google.com'): string {
  return (
    `https://${resolutionHost}/videoplayback?expire=${expire}` +
    `&id=${FILE_ID}&itag=${itag}&source=webdrive&driveid=${FILE_ID}` +
    `&mime=video%2Fmp4&sig=ABC123SIGNATURE`
  );
}

function jsonResponse(body: unknown, status = 200): GoogleDriveHttpResponse {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

function textResponse(body: string, status = 200, contentType = 'text/plain'): GoogleDriveHttpResponse {
  return { status, contentType, body };
}

describe('Google Drive URL parsing', () => {
  it('parses /file/d/<id>/view', () => {
    const url = new URL(`https://drive.google.com/file/d/${FILE_ID}/view`);
    expect(extractGoogleDriveFileId(url)).toBe(FILE_ID);
  });

  it('parses /file/d/<id>/preview', () => {
    const url = new URL(`https://drive.google.com/file/d/${FILE_ID}/preview`);
    expect(extractGoogleDriveFileId(url)).toBe(FILE_ID);
  });

  it('parses open?id=<id>', () => {
    const url = new URL(`https://drive.google.com/open?id=${FILE_ID}`);
    expect(extractGoogleDriveFileId(url)).toBe(FILE_ID);
  });

  it('preserves resource keys', () => {
    const parsed = parseGoogleDriveUrl(
      new URL(`https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=0-abc123`),
    );
    expect(parsed?.resourceKey).toBe('0-abc123');
  });

  it('rejects an invalid id', () => {
    expect(extractGoogleDriveFileId(new URL('https://drive.google.com/file/d/short/view'))).toBeNull();
  });

  it('rejects a malformed URL path', () => {
    expect(extractGoogleDriveFileId(new URL('https://drive.google.com/file/d//view'))).toBeNull();
  });

  it('rejects the wrong domain', () => {
    expect(
      extractGoogleDriveFileId(new URL(`https://evil-drive.google.com.attacker.net/file/d/${FILE_ID}/view`)),
    ).toBeNull();
  });
});

describe('Google Drive quality mapping', () => {
  it('maps a known itag', () => {
    expect(resolutionFromItag(37)).toBe(1080);
    expect(isKnownItag(37)).toBe(true);
  });

  it('returns undefined for an unknown itag', () => {
    expect(resolutionFromItag(9999)).toBeUndefined();
    expect(isKnownItag(9999)).toBe(false);
  });

  it('deduplicates resolutions and keeps the better mime', () => {
    const sorted = sortAndDedupeVariants([
      { src: 'a', resolution: 720, mimeType: 'video/webm', contentLength: 10 },
      { src: 'b', resolution: 1080, mimeType: 'video/mp4', contentLength: 20 },
      { src: 'c', resolution: 720, mimeType: 'video/mp4', contentLength: 30 },
      { src: 'd', resolution: 360, mimeType: 'video/mp4', contentLength: 5 },
    ]);

    expect(sorted.map((item) => item.resolution)).toEqual([1080, 720, 360]);
    expect(sorted[1]?.src).toBe('c');
  });

  it('reports the highest available resolution', () => {
    expect(highestResolution([{ src: 'a', resolution: 360 }, { src: 'b', resolution: 1080 }])).toBe(1080);
  });
});

describe('Google Drive expiration', () => {
  it('parses expire from a playback URL', () => {
    const expire = 1_789_469_511;
    expect(parseExpireParam(signedUrl(37, expire))?.getTime()).toBe(expire * 1000);
  });

  it('picks the earliest expiration', () => {
    const earliest = earliestExpiration([signedUrl(37, 2_000), signedUrl(22, 1_500), signedUrl(18, 1_800)]);
    expect(earliest?.getTime()).toBe(1_500_000);
  });

  it('applies a safety margin before Google expiry', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
    const ttl = cacheTtlSeconds(expiresAt, now);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThan(60 * 60);
  });

  it('detects an expired descriptor', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isExpired(new Date(now.getTime() - 1000), now)).toBe(true);
    expect(isExpired(new Date(now.getTime() + 60_000), now)).toBe(false);
  });
});

describe('Google Drive response parsing', () => {
  it('parses progressive transcodes from the playback API', () => {
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const parsed = parsePlaybackApiBody({
      mediaStreamingData: {
        formatStreamingData: {
          progressiveTranscodes: [
            {
              url: signedUrl(37, expire),
              itag: 37,
              transcodeMetadata: { height: 1080, mimeType: 'video/mp4', contentLength: 1000 },
            },
            {
              url: signedUrl(22, expire),
              itag: 22,
              transcodeMetadata: { height: 720, mimeType: 'video/mp4', contentLength: 500 },
            },
            {
              url: signedUrl(18, expire),
              itag: 18,
              transcodeMetadata: { height: 360, mimeType: 'video/mp4', contentLength: 200 },
            },
          ],
        },
      },
      mediaMetadata: { title: 'Big Buck Bunny.mp4', duration: '45.069s' },
    });

    expect(parsed?.streams.map((stream) => stream.resolution)).toEqual([1080, 720, 360]);
    expect(parsed?.durationSeconds).toBeCloseTo(45.069);
  });

  it('parses legacy get_video_info bodies', () => {
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const body = new URLSearchParams({
      status: 'ok',
      fmt_list: '37/1920x1080,22/1280x720',
      fmt_stream_map: `37|${encodeURIComponent(signedUrl(37, expire))},22|${encodeURIComponent(signedUrl(22, expire))}`,
      length_seconds: '45',
    }).toString();

    const parsed = parseVideoInfoBody(body);
    expect(parsed.streams).toHaveLength(2);
    expect(parsed.streams[0]?.resolution).toBe(1080);
  });

  it('extracts fmt_stream_map from viewer HTML', () => {
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const html = `<script>var x = {"fmt_stream_map":"18|${encodeURIComponent(signedUrl(18, expire))}"};</script>`;
    const streams = parseViewerHtml(html);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.resolution).toBe(360);
  });

  it('rejects media URLs from unclaimed hosts', () => {
    const parsed = parsePlaybackApiBody({
      mediaStreamingData: {
        formatStreamingData: {
          progressiveTranscodes: [
            {
              url: 'https://evil.example/video.mp4',
              itag: 18,
              transcodeMetadata: { height: 360, mimeType: 'video/mp4' },
            },
          ],
        },
      },
    });

    expect(parsed?.streams).toEqual([]);
  });
});

describe('Google Drive resolver', () => {
  it('resolves multiple qualities from an accessible video', async () => {
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const fetchImpl: GoogleDriveFetch = async (url) => {
      if (url.includes('/playback')) {
        return jsonResponse({
          mediaStreamingData: {
            formatStreamingData: {
              progressiveTranscodes: [
                {
                  url: signedUrl(37, expire),
                  itag: 37,
                  transcodeMetadata: { height: 1080, mimeType: 'video/mp4' },
                },
                {
                  url: signedUrl(22, expire),
                  itag: 22,
                  transcodeMetadata: { height: 720, mimeType: 'video/mp4' },
                },
                {
                  url: signedUrl(18, expire),
                  itag: 18,
                  transcodeMetadata: { height: 360, mimeType: 'video/mp4' },
                },
              ],
            },
          },
        });
      }
      return textResponse('unused', 500);
    };

    const outcome = await new GoogleDriveResolver({ fetch: fetchImpl }).resolve(FILE_ID);
    expect(outcome.status).toBe('resolved');
    expect(outcome.playback.streamUrls.map((s) => s.resolution)).toEqual([1080, 720, 360]);
    expect(outcome.playback.playerUrl).toBe(`https://drive.google.com/file/d/${FILE_ID}/preview`);
    expect(outcome.playback.useHlsByDefault).toBe(false);
  });

  it('marks inaccessible videos as access denied', async () => {
    const fetchImpl: GoogleDriveFetch = async () => jsonResponse({ error: { code: 403 } }, 403);
    const outcome = await new GoogleDriveResolver({ fetch: fetchImpl }).resolve(FILE_ID);
    expect(outcome.status).toBe('access_denied');
    expect(outcome.playback.streamUrls).toEqual([]);
  });

  /*
   * Regression: Google throttles playback per file, and both surfaces report it
   * differently — a 429 from the playback API, and a 200 body with
   * `errorcode=150` from get_video_info. Classifying either as `not_found`
   * reported a working file as permanently unavailable and discarded the
   * preview iframe, which keeps playing while the quota is exhausted.
   */
  it('treats an exhausted playback quota as rate limiting, not a missing file', async () => {
    const fetchImpl: GoogleDriveFetch = () =>
      Promise.resolve(
        jsonResponse(
          { error: { code: 429, message: 'playback quota exhausted', status: 'RESOURCE_EXHAUSTED' } },
          429,
        ),
      );

    const outcome = await new GoogleDriveResolver({ fetch: fetchImpl }).resolve(FILE_ID);

    expect(outcome.status).toBe('rate_limited');
    // The preview URL must survive: it is what keeps the episode watchable.
    expect(outcome.playback.playerUrl).toContain('/preview');
  });

  it('detects throttling reported by get_video_info as errorcode 150', async () => {
    const fetchImpl: GoogleDriveFetch = (url) => {
      // A 500 makes the playback API inconclusive so the chain reaches
      // get_video_info, which is the surface under test here.
      if (url.includes('/playback')) return Promise.resolve(textResponse('upstream error', 500));
      if (url.includes('get_video_info')) {
        return Promise.resolve(
          textResponse(
            'status=fail&errorcode=150&reason=Unable+to+play+this+video+at+this+time.+The+number+of+allowed+playbacks+has+been+exceeded.',
          ),
        );
      }
      return Promise.resolve(textResponse('<html>ok</html>'));
    };

    const outcome = await new GoogleDriveResolver({ fetch: fetchImpl }).resolve(FILE_ID);

    expect(outcome.status).toBe('rate_limited');
    expect(outcome.playback.playerUrl).toContain('/preview');
  });

  it('still reports a genuinely missing file as not found', async () => {
    // The throttling checks must not swallow a real 404.
    const fetchImpl: GoogleDriveFetch = () =>
      Promise.resolve(jsonResponse({ error: { code: 404 } }, 404));
    const outcome = await new GoogleDriveResolver({ fetch: fetchImpl }).resolve(FILE_ID);

    expect(outcome.status).toBe('not_found');
  });

  it('falls back to preview when no variants exist', async () => {
    const fetchImpl: GoogleDriveFetch = async (url) => {
      if (url.includes('/playback')) {
        return jsonResponse({
          mediaStreamingData: { formatStreamingData: { progressiveTranscodes: [] } },
        });
      }
      if (url.includes('get_video_info')) {
        return textResponse('status=ok');
      }
      return textResponse('<html>ok</html>');
    };

    const outcome = await new GoogleDriveResolver({ fetch: fetchImpl }).resolve(FILE_ID);
    expect(outcome.status).toBe('no_variants');
    expect(outcome.playback.playerUrl).toContain('/preview');
  });

  it('handles a malformed player response without crashing', async () => {
    const fetchImpl: GoogleDriveFetch = async (url) => {
      if (url.includes('/playback')) return textResponse('{not-json', 200, 'application/json');
      if (url.includes('get_video_info')) return textResponse('%%%');
      return textResponse('<html></html>');
    };

    const outcome = await new GoogleDriveResolver({ fetch: fetchImpl }).resolve(FILE_ID);
    expect(['malformed', 'no_variants']).toContain(outcome.status);
  });
});

describe('Google Drive provider + cache', () => {
  it('returns a native descriptor with qualities and iframe fallback', async () => {
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const fetchImpl: GoogleDriveFetch = async () =>
      jsonResponse({
        mediaStreamingData: {
          formatStreamingData: {
            progressiveTranscodes: [
              {
                url: signedUrl(37, expire),
                itag: 37,
                transcodeMetadata: { height: 1080, mimeType: 'video/mp4' },
              },
            ],
          },
        },
      });

    const provider = createGoogleDriveProvider({ fetch: fetchImpl });
    const descriptor = await provider.resolvePlayback(source(), context);

    expect(descriptor.type).toBe('native');
    if (descriptor.type !== 'native') throw new Error('expected native');
    expect(descriptor.sources[0]?.resolution).toBe(1080);
    expect(descriptor.fallback?.src).toContain('/preview');
  });

  /*
   * The behaviour a viewer actually experiences: a throttled file must still
   * produce a playable descriptor. Before this, `throwOnHardFailure` turned the
   * misclassified throttle into MEDIA_SOURCE_UNAVAILABLE and the episode showed
   * "This source is currently unavailable" despite the preview working.
   */
  it('serves the preview iframe when the playback quota is exhausted', async () => {
    const fetchImpl: GoogleDriveFetch = () =>
      Promise.resolve(jsonResponse({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429));

    const provider = createGoogleDriveProvider({ fetch: fetchImpl, throwOnHardFailure: true });
    const descriptor = await provider.resolvePlayback(source(), context);

    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('expected iframe');
    expect(descriptor.url).toContain('/preview');
  });

  it('caches hits and re-resolves after expiry', async () => {
    let calls = 0;
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const fetchImpl: GoogleDriveFetch = async () => {
      calls += 1;
      return jsonResponse({
        mediaStreamingData: {
          formatStreamingData: {
            progressiveTranscodes: [
              {
                url: signedUrl(22, expire),
                itag: 22,
                transcodeMetadata: { height: 720, mimeType: 'video/mp4' },
              },
            ],
          },
        },
      });
    };

    const store = new MemoryPlaybackCacheStore();
    const cache = new PlaybackCache({ store });
    const provider = createGoogleDriveProvider({ fetch: fetchImpl, cache });

    await provider.resolvePlayback(source(), context);
    await provider.resolvePlayback(source(), context);
    expect(calls).toBe(1);

    await cache.invalidate(MediaProviderId.GOOGLE_DRIVE, FILE_ID, null);
    await provider.resolvePlayback(source(), context);
    expect(calls).toBe(2);
  });

  it('does not poison the cache on provider failure', async () => {
    const store = new MemoryPlaybackCacheStore();
    const cache = new PlaybackCache({ store });
    const fetchImpl: GoogleDriveFetch = async () => jsonResponse({ error: { code: 500 } }, 500);
    const provider = createGoogleDriveProvider({ fetch: fetchImpl, cache });

    const descriptor = await provider.resolvePlayback(source(), context);
    expect(descriptor.type).toBe('iframe');

    const cached = await cache.get(MediaProviderId.GOOGLE_DRIVE, FILE_ID, null);
    // iframe fallback may be cached briefly; unavailable must never be.
    if (cached !== null) expect(cached.type).not.toBe('unavailable');
  });

  it('rejects signed URLs from durable persistence helpers', () => {
    expect(() =>
      assertNoSignedPlaybackUrlInPersistence(signedUrl(18, 1_800), 'canonical_url'),
    ).toThrow(/signed playback URL/);
    expect(isLikelySignedPlaybackUrl(`https://drive.google.com/file/d/${FILE_ID}/view`)).toBe(false);
  });
});
