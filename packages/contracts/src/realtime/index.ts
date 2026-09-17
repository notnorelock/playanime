import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Uuid } from '../common/index.js';
import {
  AccountClientEvent,
  AccountServerEvent,
  ClientEvent,
  PlaybackAction,
  PlaybackState,
  ServerEvent,
} from './events.js';

export * from './events.js';

/**
 * Authoritative watch-party playback state.
 *
 * `positionSeconds` is the position **at `updatedAt`**, not "now". A client
 * computes the live position by projecting forward:
 *
 *   live = positionSeconds + (now - updatedAt) * playbackRate   // when playing
 *   live = positionSeconds                                      // when paused
 *
 * This is what lets the server avoid broadcasting position continuously. State
 * is published on transport changes (play/pause/seek/rate/episode) plus a low
 * frequency heartbeat for drift correction, not every frame.
 */
export const PartyPlayback = Type.Object({
  episodeId: Uuid,
  state: Type.Union([
    Type.Literal(PlaybackState.PLAYING),
    Type.Literal(PlaybackState.PAUSED),
    Type.Literal(PlaybackState.BUFFERING),
    Type.Literal(PlaybackState.ENDED),
  ]),
  positionSeconds: Type.Number({ minimum: 0 }),
  playbackRate: Type.Number({ minimum: 0.25, maximum: 4 }),
  /** Server clock when this state was recorded. Clients project from here. */
  updatedAt: IsoDateTime,
  /** Monotonic counter. Clients discard out-of-order updates. */
  revision: Type.Integer({ minimum: 0 }),
});
export type PartyPlayback = Static<typeof PartyPlayback>;

export const PartyMember = Type.Object({
  userId: Uuid,
  username: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  isHost: Type.Boolean(),
  joinedAt: IsoDateTime,
});
export type PartyMember = Static<typeof PartyMember>;

export const PartyState = Type.Object({
  roomId: Uuid,
  hostUserId: Uuid,
  playback: PartyPlayback,
  memberCount: Type.Integer({ minimum: 0 }),
});
export type PartyState = Static<typeof PartyState>;

export const PartyChatMessage = Type.Object({
  id: Uuid,
  roomId: Uuid,
  author: PartyMember,
  body: Type.String({ maxLength: 1000 }),
  sentAt: IsoDateTime,
});
export type PartyChatMessage = Static<typeof PartyChatMessage>;

/* -------------------------------------------------------------------------- */
/* Client -> server                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A playback *intent*. The client asks; the server decides. Only the host's
 * intent is honoured today, but modelling it as a request rather than a command
 * means shared control is a server-side policy change, not a protocol change.
 */
export const PlaybackIntent = Type.Object({
  action: Type.Union([
    Type.Literal(PlaybackAction.PLAY),
    Type.Literal(PlaybackAction.PAUSE),
    Type.Literal(PlaybackAction.SEEK),
    Type.Literal(PlaybackAction.RATE),
    Type.Literal(PlaybackAction.EPISODE_CHANGE),
  ]),
  positionSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  playbackRate: Type.Optional(Type.Number({ minimum: 0.25, maximum: 4 })),
  episodeId: Type.Optional(Uuid),
});
export type PlaybackIntent = Static<typeof PlaybackIntent>;

export const ClientMessage = Type.Union([
  Type.Object({ type: Type.Literal(ClientEvent.PING), sentAt: Type.Integer() }),
  Type.Object({ type: Type.Literal(ClientEvent.JOIN_PARTY), roomId: Uuid }),
  Type.Object({ type: Type.Literal(ClientEvent.LEAVE_PARTY), roomId: Uuid }),
  Type.Object({ type: Type.Literal(ClientEvent.SYNC_REQUEST), roomId: Uuid }),
  Type.Object({ type: Type.Literal(ClientEvent.PLAYBACK_INTENT), roomId: Uuid, intent: PlaybackIntent }),
  Type.Object({ type: Type.Literal(ClientEvent.CHAT_SEND), roomId: Uuid, body: Type.String({ minLength: 1, maxLength: 1000 }) }),
  Type.Object({ type: Type.Literal(ClientEvent.REACTION_SEND), roomId: Uuid, kind: Type.String({ maxLength: 32 }), positionSeconds: Type.Number({ minimum: 0 }) }),
  Type.Object({ type: Type.Literal(ClientEvent.TYPING), roomId: Uuid, isTyping: Type.Boolean() }),
]);
export type ClientMessage = Static<typeof ClientMessage>;

/* -------------------------------------------------------------------------- */
/* Server -> client                                                            */
/* -------------------------------------------------------------------------- */

export const ServerMessage = Type.Union([
  Type.Object({ type: Type.Literal(ServerEvent.PONG), sentAt: Type.Integer(), serverTime: Type.Integer() }),
  Type.Object({ type: Type.Literal(ServerEvent.ERROR), code: Type.String(), message: Type.String() }),
  Type.Object({ type: Type.Literal(ServerEvent.PARTY_STATE), state: PartyState }),
  Type.Object({ type: Type.Literal(ServerEvent.PARTY_MEMBERS), roomId: Uuid, members: Type.Array(PartyMember) }),
  Type.Object({ type: Type.Literal(ServerEvent.PLAYBACK_UPDATE), roomId: Uuid, playback: PartyPlayback }),
  Type.Object({ type: Type.Literal(ServerEvent.CHAT_MESSAGE), message: PartyChatMessage }),
  Type.Object({ type: Type.Literal(ServerEvent.REACTION), roomId: Uuid, userId: Uuid, kind: Type.String(), positionSeconds: Type.Number() }),
  Type.Object({ type: Type.Literal(ServerEvent.TYPING), roomId: Uuid, userId: Uuid, isTyping: Type.Boolean() }),
  Type.Object({ type: Type.Literal(ServerEvent.PRESENCE), userId: Uuid, online: Type.Boolean() }),
  Type.Object({ type: Type.Literal(ServerEvent.VIEWER_COUNT), roomId: Uuid, count: Type.Integer({ minimum: 0 }) }),
]);
export type ServerMessage = Static<typeof ServerMessage>;

/** Narrows a server message by its discriminant, for exhaustive client handling. */
export type ServerMessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;
export type ClientMessageOf<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

/**
 * Projects authoritative state to a live position.
 *
 * Shared between the player and the party UI so both agree on the arithmetic.
 */
export function projectPosition(playback: PartyPlayback, nowMs: number = Date.now()): number {
  if (playback.state !== PlaybackState.PLAYING) return playback.positionSeconds;
  const elapsedSeconds = (nowMs - Date.parse(playback.updatedAt)) / 1000;
  return Math.max(0, playback.positionSeconds + elapsedSeconds * playback.playbackRate);
}

/** Resync threshold. Below this, a correction is more jarring than the drift. */
export const DRIFT_TOLERANCE_SECONDS = 1.5;

/** Heartbeat cadence for drift correction — not a per-frame broadcast. */
export const SYNC_HEARTBEAT_MS = 10_000;

export function shouldResync(localSeconds: number, authoritativeSeconds: number): boolean {
  return Math.abs(localSeconds - authoritativeSeconds) > DRIFT_TOLERANCE_SECONDS;
}

/* -------------------------------------------------------------------------- */
/* Account realtime: session revocation, playback handoff                     */
/* -------------------------------------------------------------------------- */
/*
 * Rides the same /api/v1/ws socket as the watch-party messages above, but is
 * a separate discriminated union — see AccountClientEvent/AccountServerEvent
 * in ./events.ts for why this is a distinct vocabulary, not an extension of
 * ClientMessage/ServerMessage.
 */

export const SessionRevokedPayload = Type.Object({
  sessionId: Uuid,
});
export type SessionRevokedPayload = Static<typeof SessionRevokedPayload>;

export const AccountClientMessage = Type.Union([
  Type.Object({ type: Type.Literal(AccountClientEvent.PING), sentAt: Type.Integer() }),
]);
export type AccountClientMessage = Static<typeof AccountClientMessage>;

export const AccountServerMessage = Type.Union([
  Type.Object({ type: Type.Literal(AccountServerEvent.PONG), sentAt: Type.Integer() }),
  Type.Object({ type: Type.Literal(AccountServerEvent.SESSION_REVOKED), sessionId: Uuid }),
]);
export type AccountServerMessage = Static<typeof AccountServerMessage>;
