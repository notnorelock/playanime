import type { GoogleDriveFetch, GoogleDriveHttpResponse, GoogleDriveResolverOptions } from './GoogleDriveTypes.js';
import { isGoogleDriveResourceKey } from './GoogleDriveUrls.js';

/**
 * HTTP access to the same Drive viewer surfaces the browser player uses.
 *
 * This client never forwards PlayAnime cookies, authorization headers, or
 * user credentials. Resource keys are sent only when they were present on the
 * submitted share link, using Google's documented header.
 */

const DEFAULT_WEB_PLAYER_KEY = 'AIzaSyDVQw45DwoYh632gvsP5vPDqEKvb-Ywnb8';

const PLAYBACK_API_ORIGIN = 'https://content-workspacevideo-pa.googleapis.com';
const VIDEO_INFO_URL = 'https://drive.google.com/get_video_info';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

export function googleDriveWebPlayerKey(): string {
  return DEFAULT_WEB_PLAYER_KEY;
}

export function buildPlaybackApiUrl(fileId: string, key: string): string {
  const url = new URL(`${PLAYBACK_API_ORIGIN}/v1/drive/media/${encodeURIComponent(fileId)}/playback`);
  url.searchParams.set('key', key);
  return url.toString();
}

export function buildVideoInfoUrl(fileId: string, resourceKey?: string): string {
  const url = new URL(VIDEO_INFO_URL);
  url.searchParams.set('docid', fileId);
  url.searchParams.set('drive_originator_app', '303');
  if (resourceKey !== undefined) url.searchParams.set('resourcekey', resourceKey);
  return url.toString();
}

function driveHeaders(fileId: string, resourceKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'application/json, text/html, */*',
    Referer: 'https://drive.google.com/',
    Origin: 'https://drive.google.com',
  };

  if (resourceKey !== undefined && isGoogleDriveResourceKey(resourceKey)) {
    headers['X-Goog-Drive-Resource-Keys'] = `${fileId}/${resourceKey}`;
  }

  return headers;
}

export async function defaultGoogleDriveFetch(
  url: string,
  init: { method?: 'GET' | 'HEAD'; headers?: Readonly<Record<string, string>>; timeoutMs?: number } = {},
): Promise<GoogleDriveHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, init.timeoutMs ?? 10_000);

  try {
    const response = await fetch(url, {
      method: init.method ?? 'GET',
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      redirect: 'follow',
      signal: controller.signal,
    });

    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export class GoogleDriveClient {
  private readonly fetchImpl: GoogleDriveFetch;
  private readonly webPlayerKey: string;
  private readonly timeoutMs: number;

  constructor(options: GoogleDriveResolverOptions = {}) {
    this.fetchImpl =
      options.fetch ??
      ((url, init) =>
        defaultGoogleDriveFetch(url, {
          ...(init?.method === undefined ? {} : { method: init.method }),
          ...(init?.headers === undefined ? {} : { headers: init.headers }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        }));
    this.webPlayerKey = options.webPlayerKey ?? DEFAULT_WEB_PLAYER_KEY;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  playbackApiUrl(fileId: string): string {
    return buildPlaybackApiUrl(fileId, this.webPlayerKey);
  }

  async fetchPlaybackApi(fileId: string, resourceKey?: string): Promise<GoogleDriveHttpResponse> {
    return this.fetchImpl(this.playbackApiUrl(fileId), {
      headers: driveHeaders(fileId, resourceKey),
    });
  }

  async fetchVideoInfo(fileId: string, resourceKey?: string): Promise<GoogleDriveHttpResponse> {
    return this.fetchImpl(buildVideoInfoUrl(fileId, resourceKey), {
      headers: driveHeaders(fileId, resourceKey),
    });
  }

  async fetchPreviewPage(previewUrl: string, fileId: string, resourceKey?: string): Promise<GoogleDriveHttpResponse> {
    return this.fetchImpl(previewUrl, {
      headers: driveHeaders(fileId, resourceKey),
    });
  }

  get timeout(): number {
    return this.timeoutMs;
  }
}
