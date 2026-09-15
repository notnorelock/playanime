import { describe, expect, it } from 'bun:test';
import { MediaProviderId, ProviderEmbedPolicy } from '@playanime/contracts';
import { createDefaultRegistry } from '../src/registry/index.js';
import { parseSubmittedUrl } from '../src/validation/url.js';
import type { ExternalMediaSource, PlaybackContext } from '../src/types/index.js';

const registry = createDefaultRegistry();

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

describe('YouTube provider', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=2', 'dQw4w9WgXcQ'],
  ];

  it('parses every documented URL shape to the same canonical form', () => {
    for (const [input, expected] of cases) {
      const parsed = registry.parse(parseSubmittedUrl(input));
      expect(parsed.provider).toBe(MediaProviderId.YOUTUBE);
      expect(parsed.externalId).toBe(expected);
      expect(parsed.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    }
  });

  it('extracts a timestamp in seconds and in h/m/s form', () => {
    expect(registry.parse(parseSubmittedUrl('https://youtu.be/dQw4w9WgXcQ?t=90')).startSeconds).toBe(90);
    expect(
      registry.parse(parseSubmittedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).startSeconds,
    ).toBe(90);
  });

  it('falls back to a plain link for a non-video YouTube page', () => {
    const parsed = registry.parse(parseSubmittedUrl('https://www.youtube.com/@someChannel'));
    expect(parsed.provider).toBe(MediaProviderId.EXTERNAL_LINK);
  });

  it('rejects a malformed video id', () => {
    const parsed = registry.parse(parseSubmittedUrl('https://www.youtube.com/watch?v=tooshort'));
    expect(parsed.provider).toBe(MediaProviderId.EXTERNAL_LINK);
  });

  it('does not claim a look-alike hostname', () => {
    const lookalikes = [
      'https://evil-youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.attacker.net/watch?v=dQw4w9WgXcQ',
      'https://notyoutu.be/dQw4w9WgXcQ',
    ];

    for (const host of lookalikes) {
      expect(registry.resolve(parseSubmittedUrl(host)).definition.id).toBe(MediaProviderId.EXTERNAL_LINK);
    }
  });

  it('builds a privacy-enhanced embed on the documented domain', () => {
    const descriptor = registry.resolvePlayback(sourceFrom('https://youtu.be/dQw4w9WgXcQ'), context);

    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('unreachable');

    const url = new URL(descriptor.url);
    expect(url.hostname).toBe('www.youtube-nocookie.com');
    expect(url.pathname).toBe('/embed/dQw4w9WgXcQ');
    expect(url.searchParams.get('origin')).toBe('https://playani.me');
    expect(url.searchParams.get('rel')).toBe('0');
  });

  it('honours a resume offset', () => {
    const descriptor = registry.resolvePlayback(sourceFrom('https://youtu.be/dQw4w9WgXcQ'), {
      ...context,
      startSeconds: 120.7,
    });

    if (descriptor.type !== 'iframe') throw new Error('expected iframe');
    expect(new URL(descriptor.url).searchParams.get('start')).toBe('120');
  });
});

describe('Google Drive provider', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view', '1A2B3C4D5E6F7G8H9I0J'],
    ['https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/preview', '1A2B3C4D5E6F7G8H9I0J'],
    ['https://drive.google.com/open?id=1A2B3C4D5E6F7G8H9I0J', '1A2B3C4D5E6F7G8H9I0J'],
  ];

  it('parses every documented share URL shape', () => {
    for (const [input, expected] of cases) {
      const parsed = registry.parse(parseSubmittedUrl(input));
      expect(parsed.provider).toBe(MediaProviderId.GOOGLE_DRIVE);
      expect(parsed.externalId).toBe(expected);
    }
  });

  it('preserves a resource key from the shared link', () => {
    const parsed = registry.parse(
      parseSubmittedUrl('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?resourcekey=0-abc123'),
    );

    expect(parsed.resourceKey).toBe('0-abc123');
    expect(parsed.canonicalUrl).toContain('resourcekey=0-abc123');
  });

  it('drops a malformed resource key rather than forwarding it', () => {
    const parsed = registry.parse(
      parseSubmittedUrl('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?resourcekey=has%20space'),
    );

    expect(parsed.resourceKey).toBeUndefined();
  });

  it('falls back for a malformed Drive URL', () => {
    const malformed = [
      'https://drive.google.com/file/d//view',
      'https://drive.google.com/drive/folders/1A2B3C4D5E6F7G8H9I0J',
      'https://drive.google.com/',
    ];

    for (const input of malformed) {
      expect(registry.parse(parseSubmittedUrl(input)).provider).toBe(MediaProviderId.EXTERNAL_LINK);
    }
  });

  it('embeds through the documented preview viewer', () => {
    const descriptor = registry.resolvePlayback(
      sourceFrom('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view'),
      context,
    );

    expect(descriptor.type).toBe('iframe');
    if (descriptor.type !== 'iframe') throw new Error('unreachable');
    expect(descriptor.url).toBe('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/preview');
  });

  it('never produces a download or direct-stream URL', () => {
    const descriptor = registry.resolvePlayback(
      sourceFrom('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view'),
      context,
    );

    if (descriptor.type !== 'iframe') throw new Error('expected iframe');
    expect(descriptor.url).not.toContain('export=download');
    expect(descriptor.url).not.toContain('uc?');
    expect(descriptor.url).not.toContain('videoplayback');
  });
});

describe('link-only providers', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['https://www.cda.pl/video/12345abc', MediaProviderId.CDA],
    ['https://vidoza.net/abcdef123456.html', MediaProviderId.VIDOZA],
    ['https://www.mp4upload.com/abcdef123456', MediaProviderId.MP4UPLOAD],
    ['https://video.sibnet.ru/video1234567-title', MediaProviderId.SIBNET],
  ];

  it('recognizes each provider host', () => {
    for (const [input, provider] of cases) {
      expect(registry.parse(parseSubmittedUrl(input)).provider).toBe(provider);
    }
  });

  it('always resolves to an off-site link, never an iframe', () => {
    for (const [input] of cases) {
      const descriptor = registry.resolvePlayback(sourceFrom(input), context);
      expect(descriptor.type).toBe('external');
    }
  });

  it('marks every link-only provider as non-embeddable', () => {
    const linkOnly = [
      MediaProviderId.CDA,
      MediaProviderId.VIDOZA,
      MediaProviderId.MP4UPLOAD,
      MediaProviderId.SIBNET,
      MediaProviderId.EXTERNAL_LINK,
    ];

    for (const id of linkOnly) {
      expect(registry.canEmbed(id)).toBe(false);
      expect(registry.get(id).definition.embedPolicy).toBe(ProviderEmbedPolicy.LINK_ONLY);
    }
  });
});

describe('unsupported domains', () => {
  it('routes an unknown host to the external-link provider', () => {
    const parsed = registry.parse(parseSubmittedUrl('https://random-video-host.example/watch/abc'));
    expect(parsed.provider).toBe(MediaProviderId.EXTERNAL_LINK);
  });

  it('never embeds an unknown host', () => {
    const descriptor = registry.resolvePlayback(
      sourceFrom('https://random-video-host.example/watch/abc'),
      context,
    );

    expect(descriptor.type).toBe('external');
  });

  it('strips query and fragment when canonicalizing an unknown host', () => {
    const parsed = registry.parse(
      parseSubmittedUrl('https://random.example/v/abc?utm_source=x&token=y#frag'),
    );

    expect(parsed.canonicalUrl).toBe('https://random.example/v/abc');
  });
});

describe('provider allowlist', () => {
  it('permits no provider outside the declared set to be embedded', () => {
    const embeddable = registry
      .all()
      .filter((provider) => provider.definition.embedPolicy === ProviderEmbedPolicy.EMBED)
      .map((provider) => provider.definition.id)
      .sort();

    expect(embeddable).toEqual([MediaProviderId.GOOGLE_DRIVE, MediaProviderId.YOUTUBE].sort());
  });

  it('forbids every provider from emitting native playback', () => {
    for (const provider of registry.all()) {
      expect(provider.definition.canEmitNative).toBe(false);
    }
  });

  it('derives frame-src from embeddable providers only', () => {
    const origins = registry.frameSrcOrigins();

    expect(origins).toContain('https://youtube-nocookie.com');
    expect(origins).toContain('https://drive.google.com');
    expect(origins.some((origin) => origin.includes('cda.pl'))).toBe(false);
    expect(origins.some((origin) => origin.includes('vidoza'))).toBe(false);
  });
});
