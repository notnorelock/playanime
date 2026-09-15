import type { PlaybackCache } from '../../cache/PlaybackCache.js';
import type { MediaLogger } from '../google-drive/GoogleDriveTypes.js';

/**
 * Fields published by CDA's player. Tokens are optional because a page may
 * expose a direct source without enabling quality changes. The RPC builder
 * requires and validates them before any quality request is sent.
 */
export interface CdaPlayerData {
  id: string;
  video: {
    id: string;
    file?: string | null;
    manifest?: string | null;
    manifest_cast?: string | null;
    manifest_apple?: string | null;
    duration?: string;
    durationFull?: string;
    width?: number;
    height?: number;
    quality?: string;
    qualities?: Record<string, string>;
    quality_change_in_player?: boolean;
    ts?: number;
    hash?: string;
    hash2?: string;
    title?: string;
    thumb?: string;
  };
  api?: {
    client?: string;
    client2?: string;
    ts?: string;
    key?: string;
    method?: string;
  };
}

/** Provider-internal stream shape; DASH is recognized but has no player adapter. */
export interface CdaStream {
  url: string;
  type: 'hls' | 'dash' | 'mp4';
  quality?: string;
  resolution?: number;
}

/** Ephemeral resolution result. Never copy this object into source metadata. */
export interface CdaPlaybackResult {
  externalId: string;
  title?: string;
  duration?: number;
  thumbnail?: string;
  sources: CdaStream[];
  expiresAt: Date;
}

export type CdaFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The positional parameter order is part of CDA's JSON-RPC protocol. */
export interface CdaLinkRequest {
  jsonrpc: '2.0';
  method: 'videoGetLink';
  params: readonly [string, string, number, string, Record<string, never>];
  id: number;
}

export interface CdaProviderOptions {
  fetch?: CdaFetch;
  logger?: MediaLogger;
  cache?: PlaybackCache;
  now?: () => Date;
  timeoutMs?: number;
  throwOnHardFailure?: boolean;
}
