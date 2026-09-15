import { describe, expect, it } from 'bun:test';
import { MediaProviderId, ProviderEmbedPolicy } from '@playanime/contracts';
import { InternalError } from '@playanime/shared';
import { createDefaultRegistry } from '../src/registry/index.js';
import { assertDescriptorIsLegal } from '../src/validation/descriptor.js';
import { parseSubmittedUrl, InvalidSourceUrlError } from '../src/validation/url.js';
import type { ProviderDefinition } from '../src/types/index.js';

const registry = createDefaultRegistry();

describe('URL intake security', () => {
  it('rejects javascript and data schemes', () => {
    expect(() => parseSubmittedUrl('javascript:alert(1)')).toThrow(InvalidSourceUrlError);
    expect(() => parseSubmittedUrl('data:text/html,hi')).toThrow(InvalidSourceUrlError);
  });

  it('rejects credentials in the URL', () => {
    expect(() =>
      parseSubmittedUrl('https://user:pass@drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view'),
    ).toThrow(InvalidSourceUrlError);
  });

  it('rejects loopback and link-local hosts', () => {
    expect(() => parseSubmittedUrl('http://127.0.0.1/video.mp4')).toThrow(InvalidSourceUrlError);
    expect(() => parseSubmittedUrl('http://169.254.1.1/video.mp4')).toThrow(InvalidSourceUrlError);
    expect(() => parseSubmittedUrl('http://localhost/video.mp4')).toThrow(InvalidSourceUrlError);
  });

  it('rejects control characters and attribute breakers', () => {
    expect(() => parseSubmittedUrl('https://example.com/a<script>')).toThrow(InvalidSourceUrlError);
  });
});

describe('descriptor legality', () => {
  const linkOnly: ProviderDefinition = {
    id: MediaProviderId.CDA,
    label: 'CDA',
    hosts: ['cda.pl'],
    embedPolicy: ProviderEmbedPolicy.LINK_ONLY,
    canEmitNative: false,
    supportsAvailabilityCheck: false,
    reliabilityWeight: 1,
  };

  it('forbids iframe descriptors from link-only providers', () => {
    expect(() =>
      assertDescriptorIsLegal(
        {
          type: 'iframe',
          provider: MediaProviderId.CDA,
          url: 'https://www.cda.pl/video/abc',
          allow: '',
          requiresSameOrigin: false,
        },
        linkOnly,
      ),
    ).toThrow(InternalError);
  });

  it('forbids native descriptors when canEmitNative is false', () => {
    expect(() =>
      assertDescriptorIsLegal(
        {
          type: 'native',
          provider: MediaProviderId.CDA,
          sources: [{ src: 'https://cdn.example/a.mp4' }],
        },
        linkOnly,
      ),
    ).toThrow(InternalError);
  });

  it('forbids iframe hosts outside the provider claim', () => {
    const youtube = registry.get(MediaProviderId.YOUTUBE).definition;
    expect(() =>
      assertDescriptorIsLegal(
        {
          type: 'iframe',
          provider: MediaProviderId.YOUTUBE,
          url: 'https://evil.example/embed/x',
          allow: '',
          requiresSameOrigin: false,
        },
        youtube,
      ),
    ).toThrow(InternalError);
  });

  it('forbids hls descriptors when canEmitNative is false', () => {
    expect(() =>
      assertDescriptorIsLegal(
        {
          type: 'hls',
          provider: MediaProviderId.CDA,
          src: 'https://cdn.example/playlist.m3u8',
        },
        linkOnly,
      ),
    ).toThrow(InternalError);
  });

  it('forbids an hls playlist on a host the provider never claimed', () => {
    const rumble = registry.get(MediaProviderId.RUMBLE).definition;
    expect(() =>
      assertDescriptorIsLegal(
        {
          type: 'hls',
          provider: MediaProviderId.RUMBLE,
          src: 'https://evil.example/playlist.m3u8',
        },
        rumble,
      ),
    ).toThrow(InternalError);
  });

  it('forbids an hls fallback pointing off the provider hosts', () => {
    const rumble = registry.get(MediaProviderId.RUMBLE).definition;
    expect(() =>
      assertDescriptorIsLegal(
        {
          type: 'hls',
          provider: MediaProviderId.RUMBLE,
          src: 'https://rumble.com/hls-vod/a/playlist.m3u8',
          fallback: {
            type: 'iframe',
            src: 'https://evil.example/embed/x',
            allow: '',
            requiresSameOrigin: true,
          },
        },
        rumble,
      ),
    ).toThrow(InternalError);
  });

  it('accepts an hls descriptor on the provider CDN', () => {
    const rumble = registry.get(MediaProviderId.RUMBLE).definition;
    expect(
      assertDescriptorIsLegal(
        {
          type: 'hls',
          provider: MediaProviderId.RUMBLE,
          src: 'https://rumble.com/hls-vod/a/playlist.m3u8',
          fallback: {
            type: 'iframe',
            src: 'https://rumble.com/embed/v7dctl6/',
            allow: '',
            requiresSameOrigin: true,
          },
        },
        rumble,
      ).type,
    ).toBe('hls');
  });
});
