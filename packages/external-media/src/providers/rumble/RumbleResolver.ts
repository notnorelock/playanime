import { RumbleClient } from './RumbleClient.js';
import {
  parseRumbleOEmbed,
  parseRumblePlaybackMetadata,
  type RumbleOEmbedMetadata,
} from './RumbleParser.js';
import { withAllowedHostsOnly } from './RumbleQualities.js';
import type {
  MediaLogger,
  RumblePlaybackResult,
  RumbleResolveOutcome,
  RumbleResolverOptions,
} from './RumbleTypes.js';
import { buildRumbleEmbedUrl, describeRumbleMediaUrl } from './RumbleUrls.js';

/**
 * Resolves Rumble playback metadata.
 *
 * This class is the *only* place in PlayAnime that knows how Rumble currently
 * exposes streams. Everything above it sees `RumbleResolveOutcome`, so when
 * Rumble changes its player response, the change stops here.
 *
 * Two surfaces are used, both of which Rumble serves to any ordinary viewer:
 *
 * 1. **oEmbed** (`/api/Media/oembed.json`) — a documented endpoint that maps a
 *    public page URL to its embed id and basic metadata. This is required
 *    rather than convenient: the page slug is usually *not* the embed id.
 * 2. **The embed player's metadata request** — the same call the official
 *    iframe makes for the video it is about to play.
 *
 * Access control stays Rumble's. A video Rumble declines to describe is
 * reported as denied or unavailable and never probed another way.
 */

const silentLogger: MediaLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function emptyPlayback(embedId: string): RumblePlaybackResult {
  return {
    embedUrl: buildRumbleEmbedUrl(embedId),
    sources: [],
    ladder: [],
    subtitles: [],
    liveState: 'vod',
  };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

export class RumbleResolver {
  private readonly client: RumbleClient;
  private readonly logger: MediaLogger;

  constructor(options: RumbleResolverOptions = {}) {
    this.client = new RumbleClient(options);
    this.logger = options.logger ?? silentLogger;
  }

  /**
   * Resolves a public page URL to its embed identity.
   *
   * Returns `null` when Rumble does not describe the page — a removed video, a
   * non-video URL, or a page whose owner disabled embedding. Callers treat that
   * as "no embed identity", never as a reason to guess one from the slug.
   */
  async resolveEmbedIdentity(pageUrl: string): Promise<RumbleOEmbedMetadata | null> {
    let response;
    try {
      response = await this.client.fetchOEmbed(pageUrl);
    } catch (error) {
      this.logger.error('Rumble oEmbed request failed', error);
      return null;
    }

    if (response.status === 404 || response.status === 403 || response.status === 401) {
      this.logger.info('Rumble oEmbed declined the page', { status: response.status });
      return null;
    }

    if (response.status < 200 || response.status >= 300) {
      this.logger.warn('Rumble oEmbed returned an unexpected status', {
        status: response.status,
      });
      return null;
    }

    const metadata = parseRumbleOEmbed(parseJson(response.body));
    if (metadata === null) {
      this.logger.warn('Rumble oEmbed response did not contain an embed URL');
      return null;
    }

    return metadata;
  }

  /**
   * Resolves playback variants for an embed id.
   *
   * Never throws for an upstream condition: every failure becomes a status the
   * provider can map onto the official iframe, because a metadata shape change
   * must degrade to the embed rather than break playback.
   */
  async resolve(embedId: string): Promise<RumbleResolveOutcome> {
    const embedUrl = buildRumbleEmbedUrl(embedId);

    let response;
    try {
      response = await this.client.fetchPlaybackMetadata(embedId);
    } catch (error) {
      this.logger.error('Rumble playback metadata request failed', error, { embedId });
      return {
        status: 'malformed',
        playback: emptyPlayback(embedId),
        detail: 'transport_error',
      };
    }

    if (response.status === 401 || response.status === 403) {
      this.logger.info('Rumble denied playback metadata', { embedId, status: response.status });
      return {
        status: 'access_denied',
        playback: emptyPlayback(embedId),
        detail: `http_${String(response.status)}`,
      };
    }

    if (response.status === 404 || response.status === 410) {
      return {
        status: 'not_found',
        playback: emptyPlayback(embedId),
        detail: `http_${String(response.status)}`,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      this.logger.warn('Rumble playback metadata returned an unexpected status', {
        embedId,
        status: response.status,
      });
      return {
        status: 'malformed',
        playback: emptyPlayback(embedId),
        detail: `http_${String(response.status)}`,
      };
    }

    const json = parseJson(response.body);

    /**
     * Rumble answers a removed, private, or non-embeddable video with the
     * literal `false` under HTTP 200. Reading only the status code here would
     * treat a refusal as success, so this case is explicit.
     */
    if (json === false || json === null) {
      this.logger.info('Rumble reported the video as not playable', { embedId });
      return {
        status: 'not_found',
        playback: emptyPlayback(embedId),
        detail: 'provider_returned_false',
      };
    }

    const metadata = parseRumblePlaybackMetadata(json);
    if (metadata === null) {
      this.logger.warn('Rumble playback metadata did not match a known shape', { embedId });
      return {
        status: 'malformed',
        playback: emptyPlayback(embedId),
        detail: 'unrecognized_shape',
      };
    }

    // A rendition on a non-Rumble host is dropped before it can reach a
    // descriptor, even though the response itself was genuine.
    const sources = withAllowedHostsOnly(metadata.sources);
    const rejected = metadata.sources.length - sources.length;
    if (rejected > 0) {
      this.logger.warn('Rumble returned media URLs on unexpected hosts', {
        embedId,
        'data.rejected': rejected,
      });
    }

    const subtitles = metadata.subtitles.filter((track) =>
      withAllowedHostsOnly([{ url: track.url, type: 'hls' }]).length > 0,
    );

    const playback: RumblePlaybackResult = {
      embedUrl,
      sources,
      ladder: metadata.ladder,
      subtitles,
      liveState: metadata.liveState,
      ...(metadata.durationSeconds === undefined
        ? {}
        : { durationSeconds: metadata.durationSeconds }),
      ...(metadata.title === undefined ? {} : { title: metadata.title }),
      ...(metadata.thumbnail === undefined ? {} : { thumbnail: metadata.thumbnail }),
      ...(metadata.channel === undefined ? {} : { channel: metadata.channel }),
    };

    if (sources.length === 0) {
      this.logger.info('Rumble playback resolved without a playable variant', { embedId });
      return { status: 'no_variants', playback, detail: 'no_playable_formats' };
    }

    this.logger.info('Rumble playback resolved', {
      embedId,
      formats: [...new Set(sources.map((source) => source.type))],
      // For an adaptive stream the resolutions live in the advertised ladder
      // rather than on the single playlist source.
      qualities: (metadata.ladder.length > 0
        ? metadata.ladder.map((rung) => rung.resolution)
        : sources
            .map((source) => source.resolution)
            .filter((value): value is number => value !== undefined)
      ).map((value) => Math.round(value)),
      subtitles: subtitles.length,
      live: metadata.liveState === 'live',
      // Path only. A full CDN URL carries signed byte ranges and is long enough
      // to bloat logs on its own.
      'data.media': describeRumbleMediaUrl(sources[0]?.url ?? ''),
    });

    return { status: 'resolved', playback };
  }
}
