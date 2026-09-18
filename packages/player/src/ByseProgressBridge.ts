/**
 * Bridges Byse's documented `byse-progress` iframe postMessage into the
 * generic playback-progress callbacks every other adapter already exposes
 * (`onTimeUpdate` / `onPaused`), so the host page's watch-progress wiring
 * (throttling, minimum-position guard, the save endpoint) is reused unchanged
 * rather than duplicated for one provider.
 *
 * Byse's documented payload:
 *
 *   { type: "byse-progress", file_code, progress, timestamp, duration }
 *
 * The docs say events are already throttled to roughly once a second and are
 * also sent on play/pause transitions; this bridge does not add its own
 * throttling on top — that stays the host page's job (`useWatchProgress`),
 * same as it is for the native `<video>` `timeupdate` event.
 *
 * Every message is treated as untrusted input from a third-party frame
 * until it passes every one of: expected origin, expected `type`, expected
 * `file_code`, and every numeric field finite. A message failing any check is
 * dropped silently — it is not this bridge's job to report on postMessage
 * traffic aimed at the page for some other reason.
 */

export interface ByseProgressEvent {
  readonly positionSeconds: number;
  readonly durationSeconds: number;
}

/**
 * Recovers the file code and trusted origin from a Byse `iframe` descriptor's
 * `url` — `https://{embed-domain}/e/{fileCode}` — so the player layer can
 * scope a progress bridge to exactly this source without re-deriving Byse's
 * URL shape itself. Mirrors `@playanime/external-media`'s own parsing rather
 * than reimplementing it independently; kept here rather than imported from
 * there because `@playanime/player` runs in the browser and must not depend
 * on the server-side provider package.
 */
export function parseByseEmbedUrl(url: string): { readonly fileCode: string; readonly origin: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const match = /^\/e\/([^/?#]+)\/?$/.exec(parsed.pathname);
  const fileCode = match?.[1];
  if (fileCode === undefined || fileCode.length === 0) return null;

  return { fileCode: decodeURIComponent(fileCode), origin: parsed.origin };
}

export interface ByseProgressBridgeOptions {
  /** Origin the embed iframe was loaded from — the only origin ever trusted. */
  readonly expectedOrigin: string;
  /** The file code of the currently active Byse source. */
  readonly expectedFileCode: string;
  readonly onProgress: (event: ByseProgressEvent) => void;
  /** Byse also fires the same event shape on a pause transition. */
  readonly onPause?: (event: ByseProgressEvent) => void;
  readonly window?: Window;
}

interface RawBysePayload {
  readonly type: unknown;
  readonly file_code: unknown;
  readonly progress: unknown;
  readonly timestamp: unknown;
  readonly duration: unknown;
  readonly paused?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates and narrows one `message` event's data down to a usable progress
 * reading, or `null` when any documented invariant does not hold.
 *
 * Exported standalone (not just used internally) so it can be unit-tested
 * against the exact payload shapes the docs and the task specify, without
 * needing a real `window`/iframe.
 */
export function parseByseProgressPayload(
  data: unknown,
  expectedFileCode: string,
): (ByseProgressEvent & { readonly paused: boolean }) | null {
  if (!isRecord(data)) return null;
  const payload = data as unknown as RawBysePayload;

  if (payload.type !== 'byse-progress') return null;
  if (payload.file_code !== expectedFileCode) return null;
  if (!isFiniteNumber(payload.timestamp)) return null;
  if (!isFiniteNumber(payload.duration)) return null;
  if (!isFiniteNumber(payload.progress)) return null;
  if (payload.timestamp < 0 || payload.duration < 0) return null;

  return {
    // `timestamp` is the documented playhead field; `progress` is a
    // percentage in the docs' own example (42.75 of a 300.5s video), so the
    // clamped timestamp is what a caller actually wants as "position".
    positionSeconds: Math.min(payload.timestamp, payload.duration > 0 ? payload.duration : payload.timestamp),
    durationSeconds: payload.duration,
    paused: payload.paused === true,
  };
}

/**
 * Listens for Byse's `byse-progress` postMessage while attached, forwarding
 * validated readings to `onProgress`/`onPause`.
 *
 * One bridge is scoped to exactly one active source: a stale bridge left
 * attached after a source switch would otherwise let an old iframe's events
 * update the new episode's progress, which is why the provider/player layer
 * must create a new instance (and `destroy()` the old one) on every source
 * change rather than reusing one across episodes.
 */
export class ByseProgressBridge {
  private readonly options: ByseProgressBridgeOptions;
  private readonly targetWindow: Window;
  private readonly listener = (event: MessageEvent): void => {
    if (event.origin !== this.options.expectedOrigin) return;

    const parsed = parseByseProgressPayload(event.data, this.options.expectedFileCode);
    if (parsed === null) return;

    const reading: ByseProgressEvent = {
      positionSeconds: parsed.positionSeconds,
      durationSeconds: parsed.durationSeconds,
    };

    if (parsed.paused) {
      this.options.onPause?.(reading);
      return;
    }
    this.options.onProgress(reading);
  };

  constructor(options: ByseProgressBridgeOptions) {
    this.options = options;
    this.targetWindow = options.window ?? window;
    this.targetWindow.addEventListener('message', this.listener);
  }

  destroy(): void {
    this.targetWindow.removeEventListener('message', this.listener);
  }
}
