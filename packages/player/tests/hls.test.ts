import { describe, expect, it } from 'bun:test';
import type { HlsPlayback } from '@playanime/contracts';
import { HlsVideoAdapter } from '../src/HlsVideoAdapter.js';
import { buildHlsQualityOptions, type HlsEngine, type HlsEngineFactory } from '../src/types.js';

/**
 * HLS adapter tests.
 *
 * The adapter is provider-agnostic: these descriptors could equally have come
 * from any provider that publishes a master playlist. No Rumble specifics
 * appear here, which is the point of the descriptor contract.
 */

const descriptor: HlsPlayback = {
  type: 'hls',
  provider: 'rumble',
  src: 'https://rumble.com/hls-vod/abc/playlist.m3u8',
  live: false,
  variants: [
    { resolution: 720, bandwidth: 922_000 },
    { resolution: 480, bandwidth: 577_000 },
    { resolution: 360, bandwidth: 426_000 },
  ],
  fallback: {
    type: 'iframe',
    src: 'https://rumble.com/embed/v7dctl6/',
    allow: 'autoplay; fullscreen',
    requiresSameOrigin: true,
  },
};

interface FakeVideo {
  src: string;
  currentTime: number;
  readyState: number;
  paused: boolean;
  canPlayType(type: string): string;
  addEventListener(event: string, handler: () => void): void;
  removeEventListener(event: string, handler: () => void): void;
}

function fakeVideo(options: { nativeHls?: boolean; readyState?: number } = {}): FakeVideo {
  return {
    src: '',
    paused: true,
    currentTime: 0,
    readyState: options.readyState ?? 1,
    canPlayType: (type: string) =>
      options.nativeHls === true && type.toLowerCase().includes('mpegurl') ? 'maybe' : '',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

class FakeEngine implements HlsEngine {
  loadedSource: string | null = null;
  attached = false;
  destroyed = false;
  currentLevel = -1;
  levels: readonly { height?: number; bitrate?: number }[] = [
    { height: 360 },
    { height: 480 },
    { height: 720 },
  ];

  private handlers = new Map<string, (event: string, data: unknown) => void>();

  loadSource(src: string): void {
    this.loadedSource = src;
  }
  attachMedia(): void {
    this.attached = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  on(event: string, handler: (event: string, data: unknown) => void): void {
    this.handlers.set(event, handler);
  }
  emit(event: string, data: unknown): void {
    this.handlers.get(event)?.(event, data);
  }
}

function engineFactory(engine: HlsEngine, supported = true): HlsEngineFactory {
  return { isSupported: () => supported, create: () => engine };
}

/* -------------------------------------------------------------------------- */

describe('HLS quality options', () => {
  it('uses separate playlist resolutions without inventing master levels', () => {
    expect(
      buildHlsQualityOptions({
        type: 'hls',
        provider: 'cda',
        src: 'https://media.example/720.m3u8',
        sources: [
          { src: 'https://media.example/720.m3u8', resolution: 720 },
          { src: 'https://media.example/360.m3u8', resolution: 360 },
        ],
      }),
    ).toEqual([
      { value: 'auto', label: 'Auto' },
      { value: 720, label: '720p' },
      { value: 360, label: '360p' },
    ]);
  });
  it('lists Auto first, then advertised renditions highest-first', () => {
    expect(buildHlsQualityOptions(descriptor)).toEqual([
      { value: 'auto', label: 'Auto' },
      { value: 720, label: '720p' },
      { value: 480, label: '480p' },
      { value: 360, label: '360p' },
    ]);
  });

  it('offers only Auto when no variants were advertised', () => {
    const bare: HlsPlayback = { type: 'hls', provider: 'rumble', src: descriptor.src };
    expect(buildHlsQualityOptions(bare)).toEqual([{ value: 'auto', label: 'Auto' }]);
  });
});

describe('HlsVideoAdapter', () => {
  it('restores position after replacement metadata and removes stale resume hooks', () => {
    const handlers = new Set<() => void>();
    const video = fakeVideo({ nativeHls: true });
    video.addEventListener = (_event, handler) => {
      handlers.add(handler);
    };
    video.removeEventListener = (_event, handler) => {
      handlers.delete(handler);
    };
    const adapter = new HlsVideoAdapter({ video: video as unknown as HTMLVideoElement });
    adapter.load({
      type: 'hls',
      provider: 'cda',
      src: 'https://media.example/720.m3u8',
      sources: [{ src: 'https://media.example/360.m3u8', resolution: 360 }],
    });
    video.currentTime = 50;
    adapter.setQuality(360);
    video.currentTime = 0;
    for (const handler of handlers) handler();
    expect(video.currentTime).toBe(50);
    expect(handlers.size).toBe(0);
    adapter.setQuality('auto');
    expect(handlers.size).toBe(1);
    adapter.destroy();
    expect(handlers.size).toBe(0);
  });

  it('switches separate playlists and restores the default on Auto', () => {
    const engine = new FakeEngine();
    const video = fakeVideo();
    const adapter = new HlsVideoAdapter({
      video: video as unknown as HTMLVideoElement,
      engine: engineFactory(engine),
    });
    const playlists: HlsPlayback = {
      type: 'hls',
      provider: 'cda',
      src: 'https://media.example/720.m3u8',
      sources: [
        { src: 'https://media.example/720.m3u8', resolution: 720 },
        { src: 'https://media.example/360.m3u8', resolution: 360 },
      ],
    };

    adapter.load(playlists);
    video.currentTime = 42;
    adapter.setQuality(360);
    expect(engine.loadedSource).toBe('https://media.example/360.m3u8');
    expect(video.currentTime).toBe(42);
    expect(adapter.selection).toBe(360);
    adapter.setQuality('auto');
    expect(engine.loadedSource).toBe(playlists.src);
  });

  it('switches separate playlists using native HLS too', () => {
    const video = fakeVideo({ nativeHls: true });
    const adapter = new HlsVideoAdapter({ video: video as unknown as HTMLVideoElement });
    adapter.load({
      type: 'hls',
      provider: 'cda',
      src: 'https://media.example/720.m3u8',
      sources: [{ src: 'https://media.example/360.m3u8', resolution: 360 }],
    });
    video.currentTime = 12;
    adapter.setQuality(360);
    expect(video.src).toBe('https://media.example/360.m3u8');
    expect(video.currentTime).toBe(12);
  });
  it('hands the master playlist to hls.js unexpanded', () => {
    const engine = new FakeEngine();
    const video = fakeVideo();
    const adapter = new HlsVideoAdapter({
      video: video as unknown as HTMLVideoElement,
      engine: engineFactory(engine),
    });

    adapter.load(descriptor);

    expect(engine.loadedSource).toBe(descriptor.src);
    expect(engine.attached).toBe(true);
    expect(adapter.usesEngine).toBe(true);
  });

  it('uses native playback where the browser supports HLS itself', () => {
    const video = fakeVideo({ nativeHls: true });
    const adapter = new HlsVideoAdapter({ video: video as unknown as HTMLVideoElement });

    adapter.load(descriptor);

    expect(video.src).toBe(descriptor.src);
    expect(adapter.usesEngine).toBe(false);
  });

  it('falls back to the iframe when neither hls.js nor native HLS is available', () => {
    const fallbacks: string[] = [];
    const adapter = new HlsVideoAdapter({
      video: fakeVideo({ nativeHls: false }) as unknown as HTMLVideoElement,
      onFallback: (src) => fallbacks.push(src),
    });

    adapter.load(descriptor);

    expect(fallbacks).toEqual(['https://rumble.com/embed/v7dctl6/']);
  });

  it('falls back to the iframe on a fatal load error', () => {
    const engine = new FakeEngine();
    const fallbacks: string[] = [];
    const adapter = new HlsVideoAdapter({
      video: fakeVideo() as unknown as HTMLVideoElement,
      engine: engineFactory(engine),
      onFallback: (src) => fallbacks.push(src),
    });

    adapter.load(descriptor);
    engine.emit('hlsError', { fatal: true, type: 'networkError' });

    expect(fallbacks).toEqual(['https://rumble.com/embed/v7dctl6/']);
  });

  it('ignores a non-fatal error', () => {
    const engine = new FakeEngine();
    const fallbacks: string[] = [];
    const adapter = new HlsVideoAdapter({
      video: fakeVideo() as unknown as HTMLVideoElement,
      engine: engineFactory(engine),
      onFallback: (src) => fallbacks.push(src),
    });

    adapter.load(descriptor);
    engine.emit('hlsError', { fatal: false, type: 'mediaError' });

    expect(fallbacks).toEqual([]);
  });

  it('pins the ladder to a chosen rendition and back to adaptive', () => {
    const engine = new FakeEngine();
    const adapter = new HlsVideoAdapter({
      video: fakeVideo() as unknown as HTMLVideoElement,
      engine: engineFactory(engine),
    });

    adapter.load(descriptor);

    adapter.setQuality(480);
    expect(engine.currentLevel).toBe(1);
    expect(adapter.selection).toBe(480);

    adapter.setQuality('auto');
    expect(engine.currentLevel).toBe(-1);
  });

  it('returns to adaptive when a selection matches no level', () => {
    const engine = new FakeEngine();
    const adapter = new HlsVideoAdapter({
      video: fakeVideo() as unknown as HTMLVideoElement,
      engine: engineFactory(engine),
    });

    adapter.load(descriptor);
    adapter.setQuality(2160);

    expect(engine.currentLevel).toBe(-1);
  });

  it('restores a resume position for a VOD', () => {
    const video = fakeVideo({ readyState: 2 });
    const adapter = new HlsVideoAdapter({
      video: video as unknown as HTMLVideoElement,
      engine: engineFactory(new FakeEngine()),
    });

    adapter.load(descriptor, 125);
    expect(video.currentTime).toBe(125);
  });

  it('ignores a resume position on a live stream', () => {
    const video = fakeVideo({ readyState: 2 });
    const adapter = new HlsVideoAdapter({
      video: video as unknown as HTMLVideoElement,
      engine: engineFactory(new FakeEngine()),
    });

    adapter.load({ ...descriptor, live: true }, 125);
    expect(video.currentTime).toBe(0);
  });

  it('tears down a previous engine when loading again', () => {
    const first = new FakeEngine();
    const second = new FakeEngine();
    let created = 0;
    const adapter = new HlsVideoAdapter({
      video: fakeVideo() as unknown as HTMLVideoElement,
      engine: {
        isSupported: () => true,
        create: () => {
          created += 1;
          return created === 1 ? first : second;
        },
      },
    });

    adapter.load(descriptor);
    adapter.load(descriptor);

    expect(first.destroyed).toBe(true);
    expect(second.destroyed).toBe(false);
  });

  it('renders an iframe descriptor through the fallback hook', () => {
    const fallbacks: string[] = [];
    const adapter = new HlsVideoAdapter({
      video: fakeVideo() as unknown as HTMLVideoElement,
      engine: engineFactory(new FakeEngine()),
      onFallback: (src) => fallbacks.push(src),
    });

    adapter.load({
      type: 'iframe',
      provider: 'rumble',
      url: 'https://rumble.com/embed/v7dctl6/',
      allow: 'autoplay',
      requiresSameOrigin: true,
    });

    expect(fallbacks).toEqual(['https://rumble.com/embed/v7dctl6/']);
  });

  it('refuses a descriptor type it cannot play', () => {
    const adapter = new HlsVideoAdapter({
      video: fakeVideo() as unknown as HTMLVideoElement,
      engine: engineFactory(new FakeEngine()),
    });

    expect(() => {
      adapter.load({
        type: 'unavailable',
        provider: 'rumble',
        reason: 'upstream_unavailable',
      });
    }).toThrow(/cannot load descriptor type/);
  });
});
