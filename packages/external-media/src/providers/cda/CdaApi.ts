import { ExternalMediaAccessDeniedError, ExternalMediaUnavailableError } from '../../errors.js';
import { readCappedText } from '../../http/readCappedText.js';
import { CdaError, type CdaErrorReason } from './CdaErrors.js';
import { cdaPageUrl, cdaStream, normalizeCdaUrl } from './CdaParser.js';
import type { CdaLinkRequest, CdaPlayerData, CdaProviderOptions, CdaStream } from './CdaTypes.js';

/**
 * Reproduce the player's videoGetLink payload with its own current values.
 * hash2 is already the endpoint token: it is neither decrypted nor replaced
 * with video.hash, api.key, or a locally generated signature.
 */
export function buildCdaLinkRequest(
  video: CdaPlayerData['video'],
  quality: string,
  id: number,
): CdaLinkRequest {
  cdaPageUrl(video.id);
  if (
    video.ts === undefined ||
    !Number.isSafeInteger(video.ts) ||
    video.ts <= 0 ||
    video.hash2 === undefined ||
    video.hash2.length === 0 ||
    !Object.values(video.qualities ?? {}).includes(quality)
  ) {
    throw new CdaError('CDA_QUALITY_RESOLVE_FAILED');
  }
  return {
    jsonrpc: '2.0',
    method: 'videoGetLink',
    params: [video.id, quality, video.ts, video.hash2, {}] as const,
    id,
  };
}

/** Require a matching RPC reply and explicit success before accepting resp. */
export function parseCdaLinkResponse(body: string, id: number): string {
  let data: unknown;
  try {
    data = JSON.parse(body) as unknown;
  } catch {
    throw new CdaError('CDA_API_ERROR');
  }
  if (
    typeof data !== 'object' ||
    data === null ||
    !('jsonrpc' in data) ||
    data.jsonrpc !== '2.0' ||
    !('id' in data) ||
    // CDA echoes numeric request IDs as strings on its live /vjs endpoint.
    // Accept that representation while still rejecting unrelated responses.
    (data.id !== id && data.id !== String(id)) ||
    'error' in data ||
    !('result' in data)
  ) {
    throw new CdaError('CDA_API_ERROR');
  }
  const result = data.result;
  if (
    typeof result !== 'object' ||
    result === null ||
    !('status' in result) ||
    result.status !== 'ok' ||
    !('resp' in result)
  ) {
    throw new CdaError('CDA_QUALITY_RESOLVE_FAILED');
  }
  const url = normalizeCdaUrl(result.resp);
  if (url === undefined) throw new CdaError('CDA_QUALITY_RESOLVE_FAILED');
  return url;
}

/**
 * One anonymous page resolution. No cookies or user credentials are forwarded.
 * Redirects fail closed; only the canonical page and its /vjs endpoint are fetched.
 */
export class CdaApi {
  constructor(private readonly options: CdaProviderOptions = {}) {}

  /** Fetch metadata only; this client never opens resolved stream URLs. */
  fetchPage(id: string): Promise<string> {
    return this.request(
      cdaPageUrl(id),
      { method: 'GET', headers: { Accept: 'text/html' } },
      'CDA_PAGE_FETCH_FAILED',
    );
  }

  /** CDA-specific request headers stay on CDA requests, not global fetch. */
  async videoGetLink(video: CdaPlayerData['video'], quality: string, id: number): Promise<string> {
    const page = cdaPageUrl(video.id);
    const body = await this.request(
      `${page}/vjs`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: page,
          Accept: 'application/json',
        },
        body: JSON.stringify(buildCdaLinkRequest(video, quality, id)),
      },
      'CDA_API_ERROR',
    );
    return parseCdaLinkResponse(body, id);
  }

  /**
   * Resolve the player's advertised quality map with bounded parallelism.
   * A failure belongs to that quality alone: it cannot erase another quality
   * that CDA already returned successfully. No alternative credentials or
   * endpoints are tried after a refusal.
   */
  async resolveQualities(video: CdaPlayerData['video']): Promise<CdaStream[]> {
    const entries = Object.entries(video.qualities ?? {});
    const sources: CdaStream[] = [];

    // Four in flight at most, including when CDA introduces a larger quality map.
    if (video.quality_change_in_player !== false) {
      for (let offset = 0; offset < entries.length; offset += 4) {
        const resolved = await Promise.all(
          entries.slice(offset, offset + 4).map(async ([quality, token], index) => {
            try {
              const url = await this.videoGetLink(video, token, offset + index + 1);
              const stream = cdaStream(url, quality);
              if (stream === undefined) throw new CdaError('CDA_QUALITY_RESOLVE_FAILED');
              return stream;
            } catch (error) {
              // A failed optional quality does not invalidate URLs already
              // supplied by the player. Log labels only, never RPC contents.
              this.options.logger?.warn('CDA quality could not be resolved', {
                provider: 'cda',
                'data.reason': error instanceof CdaError ? error.reason : 'CDA_QUALITY_RESOLVE_FAILED',
                ...(error instanceof ExternalMediaAccessDeniedError ||
                error instanceof ExternalMediaUnavailableError
                  ? { status: error.status }
                  : {}),
                'data.quality': quality,
              });
              return undefined;
            }
          }),
        );
        sources.push(...resolved.filter((source): source is CdaStream => source !== undefined));
      }
    }

    return sources;
  }

  private async request(url: string, init: RequestInit, reason: CdaErrorReason): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.options.timeoutMs ?? 8_000);
    // The timeout remains active while the body is read, so an upstream that
    // sends headers and then stalls cannot keep this request alive indefinitely.
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        ...init,
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new ExternalMediaAccessDeniedError('CDA denied access to this video.');
      }
      if (response.status === 404 || response.status === 410) {
        await response.body?.cancel();
        throw new ExternalMediaUnavailableError('CDA video is unavailable.');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new CdaError(reason);
      }
      return await readCappedText(response, 2 * 1024 * 1024, () => new CdaError(reason));
    } catch (error) {
      if (
        error instanceof CdaError ||
        error instanceof ExternalMediaAccessDeniedError ||
        error instanceof ExternalMediaUnavailableError
      ) {
        throw error;
      }
      throw new CdaError(reason);
    } finally {
      clearTimeout(timer);
    }
  }
}
