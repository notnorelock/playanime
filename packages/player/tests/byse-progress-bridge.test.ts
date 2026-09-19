import { describe, expect, it } from 'bun:test';
import {
  ByseProgressBridge,
  parseByseEmbedUrl,
  parseByseProgressPayload,
  type ByseProgressEvent,
} from '../src/index.js';

/**
 * `window` is browser-only and not part of Bun's test runtime, so
 * `ByseProgressBridge` is exercised against an injected `EventTarget` (its
 * `options.window` seam) that stands in for it — `postMessage`'s `origin`
 * cannot be forged from inside a real browser either way, so validating
 * against a dispatched `MessageEvent`'s `origin` field is the same check.
 */
function fakeWindow(): EventTarget {
  return new EventTarget();
}

function messageEvent(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin });
}

const VALID_PAYLOAD = {
  type: 'byse-progress',
  file_code: 'gi4o0tlro01u',
  progress: 42.75,
  timestamp: 128.4,
  duration: 300.5,
};

describe('parseByseProgressPayload (§23 valid message)', () => {
  it('accepts the documented valid message for the matching file code', () => {
    const result = parseByseProgressPayload(VALID_PAYLOAD, 'gi4o0tlro01u');
    expect(result).not.toBeNull();
    expect(result?.positionSeconds).toBe(128.4);
    expect(result?.durationSeconds).toBe(300.5);
  });

  it('rejects the wrong type', () => {
    expect(parseByseProgressPayload({ ...VALID_PAYLOAD, type: 'something-else' }, 'gi4o0tlro01u')).toBeNull();
  });

  it('rejects a mismatched file_code', () => {
    expect(parseByseProgressPayload(VALID_PAYLOAD, 'a-different-code')).toBeNull();
  });

  it('rejects NaN fields', () => {
    expect(
      parseByseProgressPayload({ ...VALID_PAYLOAD, timestamp: Number.NaN }, 'gi4o0tlro01u'),
    ).toBeNull();
    expect(
      parseByseProgressPayload({ ...VALID_PAYLOAD, duration: Number.NaN }, 'gi4o0tlro01u'),
    ).toBeNull();
    expect(
      parseByseProgressPayload({ ...VALID_PAYLOAD, progress: Number.NaN }, 'gi4o0tlro01u'),
    ).toBeNull();
  });

  it('rejects Infinity fields', () => {
    expect(
      parseByseProgressPayload({ ...VALID_PAYLOAD, duration: Number.POSITIVE_INFINITY }, 'gi4o0tlro01u'),
    ).toBeNull();
    expect(
      parseByseProgressPayload({ ...VALID_PAYLOAD, timestamp: Number.POSITIVE_INFINITY }, 'gi4o0tlro01u'),
    ).toBeNull();
  });

  it('rejects a negative timestamp or duration', () => {
    expect(parseByseProgressPayload({ ...VALID_PAYLOAD, timestamp: -1 }, 'gi4o0tlro01u')).toBeNull();
    expect(parseByseProgressPayload({ ...VALID_PAYLOAD, duration: -1 }, 'gi4o0tlro01u')).toBeNull();
  });

  it('rejects an unrelated / malformed iframe message', () => {
    expect(parseByseProgressPayload({ foo: 'bar' }, 'gi4o0tlro01u')).toBeNull();
    expect(parseByseProgressPayload('a plain string', 'gi4o0tlro01u')).toBeNull();
    expect(parseByseProgressPayload(null, 'gi4o0tlro01u')).toBeNull();
    expect(parseByseProgressPayload(undefined, 'gi4o0tlro01u')).toBeNull();
  });

  it('clamps a position that overshoots duration', () => {
    const result = parseByseProgressPayload({ ...VALID_PAYLOAD, timestamp: 999 }, 'gi4o0tlro01u');
    expect(result?.positionSeconds).toBe(300.5);
  });
});

describe('ByseProgressBridge', () => {
  it('accepts a valid message from the expected origin for the current source', () => {
    const win = fakeWindow();
    const events: ByseProgressEvent[] = [];
    const bridge = new ByseProgressBridge({
      expectedOrigin: 'https://api.byse.sx',
      expectedFileCode: 'gi4o0tlro01u',
      onProgress: (event) => events.push(event),
      window: win,
    });

    win.dispatchEvent(messageEvent(VALID_PAYLOAD, 'https://api.byse.sx'));

    expect(events).toHaveLength(1);
    expect(events[0]?.positionSeconds).toBe(128.4);

    bridge.destroy();
  });

  it('rejects a message from an unexpected origin', () => {
    const win = fakeWindow();
    const events: ByseProgressEvent[] = [];
    const bridge = new ByseProgressBridge({
      expectedOrigin: 'https://api.byse.sx',
      expectedFileCode: 'gi4o0tlro01u',
      onProgress: (event) => events.push(event),
      window: win,
    });

    win.dispatchEvent(messageEvent(VALID_PAYLOAD, 'https://evil.example'));

    expect(events).toHaveLength(0);
    bridge.destroy();
  });

  it('rejects a message aimed at a stale/previous episode\'s source', () => {
    const win = fakeWindow();
    const events: ByseProgressEvent[] = [];
    const bridge = new ByseProgressBridge({
      expectedOrigin: 'https://api.byse.sx',
      expectedFileCode: 'new-episode-code',
      onProgress: (event) => events.push(event),
      window: win,
    });

    // A message shaped for the previous episode's file code.
    win.dispatchEvent(
      messageEvent({ ...VALID_PAYLOAD, file_code: 'old-episode-code' }, 'https://api.byse.sx'),
    );

    expect(events).toHaveLength(0);
    bridge.destroy();
  });

  it('forwards every valid message through onProgress, even one carrying an undocumented paused-like field', () => {
    // The real Byse payload has no field distinguishing a pause tick from a
    // mid-playback one — an extra field on the message must not change
    // routing, since nothing here should special-case a shape the provider
    // doesn't actually document.
    const win = fakeWindow();
    const events: ByseProgressEvent[] = [];
    const bridge = new ByseProgressBridge({
      expectedOrigin: 'https://api.byse.sx',
      expectedFileCode: 'gi4o0tlro01u',
      onProgress: (event) => events.push(event),
      window: win,
    });

    win.dispatchEvent(messageEvent({ ...VALID_PAYLOAD, paused: true }, 'https://api.byse.sx'));

    expect(events).toHaveLength(1);
    bridge.destroy();
  });

  it('stops receiving events after destroy()', () => {
    const win = fakeWindow();
    const events: ByseProgressEvent[] = [];
    const bridge = new ByseProgressBridge({
      expectedOrigin: 'https://api.byse.sx',
      expectedFileCode: 'gi4o0tlro01u',
      onProgress: (event) => events.push(event),
      window: win,
    });

    bridge.destroy();
    win.dispatchEvent(messageEvent(VALID_PAYLOAD, 'https://api.byse.sx'));

    expect(events).toHaveLength(0);
  });

  it('ignores an unrelated iframe message shape entirely', () => {
    const win = fakeWindow();
    const events: ByseProgressEvent[] = [];
    const bridge = new ByseProgressBridge({
      expectedOrigin: 'https://api.byse.sx',
      expectedFileCode: 'gi4o0tlro01u',
      onProgress: (event) => events.push(event),
      window: win,
    });

    win.dispatchEvent(messageEvent({ type: 'webpack-hmr', data: {} }, 'https://api.byse.sx'));

    expect(events).toHaveLength(0);
    bridge.destroy();
  });
});

describe('parseByseEmbedUrl', () => {
  it('recovers the file code and origin from a plain embed URL', () => {
    const result = parseByseEmbedUrl('https://api.byse.sx/e/xch2ympylj8c');
    expect(result).toEqual({ fileCode: 'xch2ympylj8c', origin: 'https://api.byse.sx' });
  });

  it('recovers identity from an embed URL carrying query parameters', () => {
    const result = parseByseEmbedUrl(
      'https://api.byse.sx/e/xch2ympylj8c?poster=https%3A%2F%2Fexample.com%2Fp.jpg',
    );
    expect(result?.fileCode).toBe('xch2ympylj8c');
    expect(result?.origin).toBe('https://api.byse.sx');
  });

  it('returns null for a non-Byse-embed URL shape', () => {
    expect(parseByseEmbedUrl('https://api.byse.sx/download/xch2ympylj8c')).toBeNull();
    expect(parseByseEmbedUrl('not a url')).toBeNull();
  });
});
