import { readCappedText } from '../../http/readCappedText.js';
import { ByseError } from './ByseErrors.js';
import {
  BYSE_DEFAULT_API_BASE,
  buildByseDomainLookupUrl,
  buildByseFileInfoUrl,
} from './ByseUrls.js';
import type {
  ByseClientOptions,
  ByseDomainResponse,
  ByseFetch,
  ByseFileInfo,
} from './ByseTypes.js';

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * HTTP access to Byse's documented, key-gated API.
 *
 * Both endpoints here are optional enhancements — see `ByseResolver` — and
 * both require `BYSE_API_KEY`. Unlike `RumbleClient`, the target host is
 * PlayAnime's own configuration (`BYSE_API_BASE`), never a submitted URL, so
 * there is no redirect-chasing SSRF surface to close here: redirects are
 * simply not followed.
 */
export class ByseApi {
  private readonly apiBase: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: ByseFetch;
  private readonly timeoutMs: number;

  constructor(options: ByseClientOptions = {}) {
    this.apiBase = options.apiBase ?? BYSE_DEFAULT_API_BASE;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get configuredApiBase(): string {
    return this.apiBase;
  }

  get hasApiKey(): boolean {
    return this.apiKey !== undefined;
  }

  /** `GET /get/domain` — the current documented embed domain. */
  async getDomain(): Promise<ByseDomainResponse> {
    const body = await this.request(buildByseDomainLookupUrl(this.apiBase));

    if (typeof body['old_domain'] !== 'string' || typeof body['new_domain'] !== 'string') {
      throw new ByseError('BYSE_INVALID_API_RESPONSE');
    }

    return { oldDomain: body['old_domain'], newDomain: body['new_domain'] };
  }

  /** `GET /file/info` — documented source-level metadata for one file code. */
  async getFileInfo(fileCode: string): Promise<ByseFileInfo> {
    const record = await this.request(buildByseFileInfoUrl(fileCode, this.apiBase));

    if (typeof record['status'] !== 'number') {
      throw new ByseError('BYSE_INVALID_API_RESPONSE');
    }

    return {
      status: record['status'],
      fileCode: typeof record['file_code'] === 'string' ? record['file_code'] : fileCode,
      ...(typeof record['name'] === 'string' ? { name: record['name'] } : {}),
      // Missing/non-numeric canplay is treated as playable: Byse's own status
      // field is the authoritative "not found" signal, and a metadata shape
      // change here must never mark a healthy source dead by omission.
      canPlay: record['canplay'] !== 0 && record['canplay'] !== false,
      ...(typeof record['views_started'] === 'number'
        ? { viewsStarted: record['views_started'] }
        : {}),
      ...(typeof record['views'] === 'number' ? { views: record['views'] } : {}),
      ...(typeof record['length'] === 'number' ? { lengthSeconds: record['length'] } : {}),
      ...(typeof record['uploaded'] === 'string' ? { uploaded: record['uploaded'] } : {}),
    };
  }

  private async request(url: string): Promise<Record<string, unknown>> {
    if (this.apiKey === undefined) {
      // Both callers already gate on `hasApiKey`; this is a defensive backstop
      // so a future call site cannot accidentally send an unauthenticated
      // request to a key-gated endpoint.
      throw new ByseError('BYSE_API_UNAVAILABLE');
    }

    const target = new URL(url);
    target.searchParams.set('key', this.apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(target.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        // No cookies or ambient identity; the API key alone authenticates.
        credentials: 'omit',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ByseError('BYSE_API_UNAVAILABLE');
      }

      const text = await readCappedText(response, MAX_RESPONSE_BYTES, () => new ByseError('BYSE_API_UNAVAILABLE'));

      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ByseError('BYSE_INVALID_API_RESPONSE');
      }
    } catch (error) {
      if (error instanceof ByseError) throw error;
      throw new ByseError('BYSE_API_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}
