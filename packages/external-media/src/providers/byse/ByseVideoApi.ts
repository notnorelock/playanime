import { readCappedText } from '../../http/readCappedText.js';
import { ByseError } from './ByseErrors.js';
import type {
  ByseAttestationResponse,
  ByseEncryptedPlayback,
  ByseFetch,
  BysePlaybackFingerprint,
  BysePowChallenge,
  BysePowVerifyResult,
  ByseSkipIntro,
  ByseVideoDetails,
  ByseVideoSettings,
  MediaLogger,
} from './ByseTypes.js';

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface ByseVideoApiOptions {
  /** The resolved embed domain's origin — never a fixed/configured value, see `ByseResolver`. */
  readonly origin: string;
  readonly embedParentHost?: string;
  readonly embedParentReferrer?: string;
  readonly embedParentFrame?: string;
  readonly fetch?: ByseFetch;
  readonly timeoutMs?: number;
  readonly logger?: MediaLogger;
}

export interface ByseVideoApiRequestOptions {
  readonly captchaToken?: string;
  /**
   * Sent as `{ fingerprint }` in the request body, per the official flow —
   * not a header. Supplying one switches the request from GET to POST,
   * matching the official client exactly (a GET carries no body). Must be
   * the pared-down `BysePlaybackFingerprint` shape, never the full cached
   * `ByseFingerprint`/`ByseAttestationResponse` — Byse's server 400s
   * ("invalid request body") if `expires_at` is present here, confirmed
   * against a real request.
   */
  readonly fingerprint?: BysePlaybackFingerprint;
}

/**
 * HTTP access to Byse's `/api/videos/:id/*` playback surface.
 *
 * Distinct from `ByseApi` (the documented, key-gated `api.byse.sx`
 * endpoints): this one lives on the *resolved embed domain*, is unkeyed,
 * and authenticates the request's origin/context via headers rather than a
 * `key` query parameter — mirrors exactly what the embed iframe itself
 * sends, since that is what this surface is designed to be called from.
 */
const silentLogger: MediaLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class ByseVideoApi {
  private readonly origin: string;
  private readonly embedParentHost: string | undefined;
  private readonly embedParentReferrer: string | undefined;
  private readonly embedParentFrame: string | undefined;
  private readonly fetchImpl: ByseFetch;
  private readonly timeoutMs: number;
  private readonly logger: MediaLogger;

  constructor(options: ByseVideoApiOptions) {
    this.origin = new URL(options.origin).origin;
    this.embedParentHost = options.embedParentHost;
    this.embedParentReferrer = options.embedParentReferrer;
    this.embedParentFrame = options.embedParentFrame;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger ?? silentLogger;
  }

  // Always the "embed" surface — this integration has no "watch" (logged-in
  // owner dashboard) or "private-download" concept anywhere else in
  // PlayAnime, so those two path shapes from the official client are not
  // reproduced here at all, not merely defaulted.
  private videoUrl(fileCode: string, endpoint: string): URL {
    return new URL(`/api/videos/${encodeURIComponent(fileCode)}/embed/${endpoint}`, this.origin);
  }

  private accessUrl(endpoint: string): URL {
    return new URL(`/api/videos/access/${endpoint}`, this.origin);
  }

  async getDetails(fileCode: string): Promise<ByseVideoDetails> {
    const body = await this.request(this.videoUrl(fileCode, 'details'), { method: 'GET' });

    return {
      ...(typeof body['title'] === 'string' ? { title: body['title'] } : {}),
      ...(typeof body['poster_url'] === 'string' ? { posterUrl: body['poster_url'] } : {}),
      description: typeof body['description'] === 'string' ? body['description'] : '',
      ownerPrivate: body['owner_private'] === true,
    };
  }

  async getSettings(fileCode: string): Promise<ByseVideoSettings> {
    const body = await this.request(this.videoUrl(fileCode, 'settings'), { method: 'GET' });

    return {
      captchaRequired: body['captcha_required'] === true,
      ...(typeof body['download_allowed'] === 'boolean'
        ? { downloadAllowed: body['download_allowed'] }
        : {}),
      ...(typeof body['premium_only'] === 'boolean' ? { premiumOnly: body['premium_only'] } : {}),
    };
  }

  /** Fetches the encrypted playback envelope; the caller decrypts it (see `BysePlaybackCrypto`). */
  async getPlayback(
    fileCode: string,
    options: ByseVideoApiRequestOptions = {},
  ): Promise<{ encrypted: ByseEncryptedPlayback | null; skipIntro: ByseSkipIntro | null }> {
    // Never logs the token/confidence values themselves — only their
    // presence/length — so a support/debug log can never leak a credential.
    this.logger.info('Preparing Byse playback request', {
      provider: 'byse',
      fileCode,
      'data.method': options.fingerprint === undefined ? 'GET' : 'POST',
      'data.hasFingerprint': options.fingerprint !== undefined,
      'data.fingerprintConfidence': options.fingerprint?.confidence,
      'data.hasCaptchaToken': options.captchaToken !== undefined,
      'data.captchaTokenLength': options.captchaToken?.length ?? 0,
    });

    // A fingerprint switches this to POST with a JSON body, matching the
    // official client exactly — a GET request carries no body, so the two
    // are mutually exclusive rather than "POST always, body optional".
    const body = await this.request(this.videoUrl(fileCode, 'playback'), {
      method: options.fingerprint === undefined ? 'GET' : 'POST',
      ...(options.captchaToken === undefined ? {} : { captchaToken: options.captchaToken }),
      ...(options.fingerprint === undefined ? {} : { jsonBody: { fingerprint: options.fingerprint } }),
    });

    return {
      encrypted: parseEncryptedPlayback(body['playback']),
      skipIntro: parseSkipIntro(body['skip_intro']),
    };
  }

  async startPowCaptcha(fileCode: string): Promise<BysePowChallenge> {
    const body = await this.request(this.videoUrl(fileCode, 'captcha'), { method: 'POST', jsonBody: {} });

    const nonce = body['pow_nonce'];
    const token = body['pow_token'];
    if (typeof nonce !== 'string' || typeof token !== 'string') {
      throw new ByseError('BYSE_INVALID_API_RESPONSE');
    }

    return {
      nonce,
      difficulty: typeof body['pow_difficulty'] === 'number' ? body['pow_difficulty'] : 0,
      token,
    };
  }

  async verifyPowCaptcha(
    fileCode: string,
    powToken: string,
    solution: string,
  ): Promise<BysePowVerifyResult> {
    const body = await this.request(this.videoUrl(fileCode, 'captcha/verify'), {
      method: 'POST',
      jsonBody: { pow_token: powToken, solution },
    });

    return {
      ok: body['status'] === 'ok',
      ...(typeof body['token'] === 'string' ? { token: body['token'] } : {}),
      ...(typeof body['reason'] === 'string' ? { reason: body['reason'] } : {}),
    };
  }

  /** `POST /api/videos/access/challenge` — no request body at all, confirmed against the real client. */
  async getDeviceChallenge(): Promise<{ challengeId: string; nonce: string }> {
    const body = await this.request(this.accessUrl('challenge'), { method: 'POST' });

    const challengeId = body['challenge_id'];
    const nonce = body['nonce'];
    if (typeof challengeId !== 'string' || typeof nonce !== 'string') {
      throw new ByseError('BYSE_INVALID_API_RESPONSE');
    }

    return { challengeId, nonce };
  }

  /**
   * `POST /api/videos/access/attest` — confirmed against the real client
   * bundle to return exactly `viewer_id`/`device_id`/`token`/`confidence`/
   * `expires_at`, all required. `token` alone being present but the others
   * missing is treated as a malformed response, not a partial success —
   * every field is used somewhere downstream (`confidence`/`expires_at` by
   * the caching logic, all four identity fields by `/playback`).
   */
  async attestDevice(payload: Record<string, unknown>): Promise<ByseAttestationResponse> {
    const body = await this.request(this.accessUrl('attest'), { method: 'POST', jsonBody: payload });

    const viewerId = body['viewer_id'];
    const deviceId = body['device_id'];
    const token = body['token'];
    const confidence = body['confidence'];
    const expiresAt = body['expires_at'];

    if (
      typeof viewerId !== 'string' ||
      typeof deviceId !== 'string' ||
      typeof token !== 'string' ||
      token.length === 0 ||
      typeof confidence !== 'string' ||
      typeof expiresAt !== 'string'
    ) {
      throw new ByseError('BYSE_ATTESTATION_FAILED');
    }

    return { viewer_id: viewerId, device_id: deviceId, token, confidence, expires_at: expiresAt };
  }

  private async request(
    url: URL,
    init: {
      method: 'GET' | 'POST';
      jsonBody?: Record<string, unknown>;
      captchaToken?: string;
    },
  ): Promise<Record<string, unknown>> {
    const headers = new Headers({ Accept: 'application/json' });
    if (this.embedParentHost !== undefined) headers.set('X-Embed-Origin', this.embedParentHost);
    if (this.embedParentReferrer !== undefined) headers.set('X-Embed-Referer', this.embedParentReferrer);
    if (this.embedParentFrame !== undefined) headers.set('X-Embed-Parent', this.embedParentFrame);
    if (init.captchaToken !== undefined) headers.set('X-Captcha-Token', init.captchaToken);
    if (init.jsonBody !== undefined) headers.set('Content-Type', 'application/json');

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: init.method,
        headers,
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
        ...(init.jsonBody === undefined ? {} : { body: JSON.stringify(init.jsonBody) }),
      });

      if (!response.ok) {
        // This undocumented surface's real shape is only known from a
        // reference implementation, not published docs — unlike the
        // documented api.byse.sx endpoints, a non-2xx here needs the actual
        // status/body to diagnose (wrong path, different response shape,
        // access denied) rather than a generic reason code.
        const errorBody = await readCappedText(response, 2048, () => new Error('body too large to log')).catch(
          () => '<unreadable>',
        );

        // A precise match only: status 428 with exactly {"error":"captcha_required"}.
        // Confirmed live against production — a real, ordinary step of native
        // playback, not a transport/availability failure, so it gets its own
        // reason rather than collapsing into BYSE_API_UNAVAILABLE, which
        // ByseResolver.nativePlayback used to treat as "give up and fall
        // back to the iframe" instead of "refresh the captcha and retry
        // once." Never inferred from any other 4xx/5xx shape.
        if (response.status === 428 && parseCaptchaRequiredError(errorBody)) {
          this.logger.warn('Byse playback requires a captcha token', {
            provider: 'byse',
            status: 428,
            'data.url': url.toString(),
          });
          throw new ByseError('BYSE_CAPTCHA_REQUIRED');
        }

        this.logger.warn('Byse video-api request failed', {
          provider: 'byse',
          status: response.status,
          'data.url': url.toString(),
          'data.method': init.method,
          'data.body': errorBody.slice(0, 500),
        });
        throw new ByseError(response.status === 404 ? 'BYSE_FILE_UNAVAILABLE' : 'BYSE_API_UNAVAILABLE');
      }

      const text = await readCappedText(response, MAX_RESPONSE_BYTES, () => new ByseError('BYSE_API_UNAVAILABLE'));

      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object') {
          throw new ByseError('BYSE_INVALID_API_RESPONSE');
        }
        return parsed as Record<string, unknown>;
      } catch (parseError) {
        if (parseError instanceof ByseError) throw parseError;
        this.logger.warn('Byse video-api response was not valid JSON', {
          provider: 'byse',
          'data.url': url.toString(),
          'data.body': text.slice(0, 500),
        });
        throw new ByseError('BYSE_INVALID_API_RESPONSE');
      }
    } catch (error) {
      if (error instanceof ByseError) throw error;
      this.logger.warn('Byse video-api request threw before a response was received', {
        provider: 'byse',
        'data.url': url.toString(),
        'data.reason': error instanceof Error ? error.message : 'unknown',
      });
      throw new ByseError('BYSE_API_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** True only for the exact `{"error":"captcha_required"}` shape — never inferred from status alone. */
function parseCaptchaRequiredError(rawBody: string): boolean {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>)['error'] === 'captcha_required'
    );
  } catch {
    return false;
  }
}

function parseEncryptedPlayback(value: unknown): ByseEncryptedPlayback | null {
  if (value === null || value === undefined || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const keyParts = record['key_parts'];
  const iv = record['iv'];
  const payload = record['payload'];

  if (!Array.isArray(keyParts) || typeof iv !== 'string' || typeof payload !== 'string') {
    return null;
  }

  return {
    ...(record['version'] === undefined ? {} : { version: record['version'] as string | number }),
    keyParts: keyParts.filter((part): part is string => typeof part === 'string'),
    iv,
    payload,
  };
}

function parseSkipIntro(value: unknown): ByseSkipIntro | null {
  if (value === null || value === undefined || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const from = Number(record['from_seconds']);
  const to = Number(record['to_seconds']);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  const fromSeconds = Math.max(0, Math.floor(from));
  const toSeconds = Math.max(0, Math.floor(to));
  if (toSeconds <= fromSeconds) return null;

  return { fromSeconds, toSeconds };
}
