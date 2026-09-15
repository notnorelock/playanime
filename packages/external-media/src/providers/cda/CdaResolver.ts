import { parseExpireParam } from '../google-drive/GoogleDriveExpiration.js';
import { parseDuration } from '../google-drive/GoogleDriveParser.js';
import { CdaApi } from './CdaApi.js';
import { CdaError } from './CdaErrors.js';
import { cdaStream, extractCdaVideoId, parseCdaPlayerData } from './CdaParser.js';
import type { CdaPlaybackResult, CdaProviderOptions, CdaStream } from './CdaTypes.js';

/**
 * Resolve a fresh page and its advertised quality URLs as one operation.
 *
 * The direct player source is a useful fallback when an optional RPC fails.
 * No token, timestamp, host or resolved URL survives in durable source identity.
 * The provider above this class decides which formats the player can consume.
 */
export class CdaResolver {
  private readonly api: CdaApi;

  constructor(private readonly options: CdaProviderOptions = {}) {
    this.api = new CdaApi(options);
  }

  async resolve(input: string): Promise<CdaPlaybackResult> {
    const externalId = extractCdaVideoId(input);
    if (externalId === null) throw new CdaError('CDA_INVALID_URL');

    const { video } = parseCdaPlayerData(await this.api.fetchPage(externalId), externalId);
    const entries = Object.entries(video.qualities ?? {});
    const sources: CdaStream[] = [];

    // Do not infer a cast manifest's compatibility, or substitute it for a denied quality.
    const label = entries.find(([, token]) => token === video.quality)?.[0];
    for (const value of [video.file, video.manifest, video.manifest_apple]) {
      const stream = cdaStream(value, label);
      if (stream !== undefined) sources.push(stream);
    }

    sources.push(...(await this.api.resolveQualities(video)));

    const now = (this.options.now ?? (() => new Date()))();
    const unique = new Map<string, CdaStream>();
    for (const source of sources) {
      const expiry = parseExpireParam(source.url);
      if (expiry !== undefined && expiry.getTime() <= now.getTime() + 1000) continue;
      unique.set(source.url, source);
    }

    const playable = [...unique.values()].sort((a, b) => (b.resolution ?? 0) - (a.resolution ?? 0));
    if (playable.length === 0) throw new CdaError('CDA_VIDEO_UNAVAILABLE');

    // Even a long signed expiry is capped: CDA may revoke or rotate URLs sooner.
    // Missing expiry information gets a two-minute refresh horizon.
    const expiresAt = new Date(
      Math.min(
        now.getTime() + 120_000,
        ...playable.map((source) => parseExpireParam(source.url)?.getTime() ?? Infinity),
      ),
    );

    const duration = parseDuration(video.duration ?? video.durationFull);
    return {
      externalId,
      sources: playable,
      expiresAt,
      ...(video.title === undefined ? {} : { title: video.title }),
      ...(duration !== undefined && Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
      ...(video.thumb === undefined ? {} : { thumbnail: video.thumb }),
    };
  }
}
