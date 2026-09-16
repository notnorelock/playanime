/**
 * WebSocket event names.
 *
 * Client->server events are prefixed `c:`, server->client `s:`. The prefix makes
 * the direction obvious in logs and prevents a name colliding across the two
 * discriminated unions.
 */
export const ClientEvent = {
  PING: 'c:ping',
  JOIN_PARTY: 'c:party.join',
  LEAVE_PARTY: 'c:party.leave',
  PLAYBACK_INTENT: 'c:party.playback',
  CHAT_SEND: 'c:party.chat',
  REACTION_SEND: 'c:party.reaction',
  TYPING: 'c:party.typing',
  SYNC_REQUEST: 'c:party.sync',
} as const;
export type ClientEvent = (typeof ClientEvent)[keyof typeof ClientEvent];

export const ServerEvent = {
  PONG: 's:pong',
  ERROR: 's:error',
  PARTY_STATE: 's:party.state',
  PARTY_MEMBERS: 's:party.members',
  PLAYBACK_UPDATE: 's:party.playback',
  CHAT_MESSAGE: 's:party.chat',
  REACTION: 's:party.reaction',
  TYPING: 's:party.typing',
  PRESENCE: 's:presence',
  VIEWER_COUNT: 's:viewers',
} as const;
export type ServerEvent = (typeof ServerEvent)[keyof typeof ServerEvent];

/** Playback transport state for a watch party. */
export const PlaybackState = {
  PLAYING: 'playing',
  PAUSED: 'paused',
  BUFFERING: 'buffering',
  ENDED: 'ended',
} as const;
export type PlaybackState = (typeof PlaybackState)[keyof typeof PlaybackState];

/** The kind of playback change a client is requesting. */
export const PlaybackAction = {
  PLAY: 'play',
  PAUSE: 'pause',
  SEEK: 'seek',
  RATE: 'rate',
  EPISODE_CHANGE: 'episode_change',
} as const;
export type PlaybackAction = (typeof PlaybackAction)[keyof typeof PlaybackAction];

/**
 * Account-realtime events: session revocation and cross-device playback
 * handoff signaling. Deliberately a separate vocabulary from the
 * `ClientEvent`/`ServerEvent` pair above — those are watch-party room state
 * (many members, one shared channel per party); these are point-to-point,
 * fanned out on one channel per user to that user's own devices only. Both
 * ride the same `/api/v1/ws` socket, distinguished by these event names.
 */
export const AccountClientEvent = {
  PING: 'c:ping',
  HANDOFF_OFFER: 'c:handoff.offer',
  HANDOFF_ACCEPT: 'c:handoff.accept',
  HANDOFF_REJECT: 'c:handoff.reject',
} as const;
export type AccountClientEvent = (typeof AccountClientEvent)[keyof typeof AccountClientEvent];

export const AccountServerEvent = {
  SESSION_REVOKED: 's:session.revoked',
  HANDOFF_OFFERED: 's:handoff.offered',
  HANDOFF_ACCEPTED: 's:handoff.accepted',
  HANDOFF_REJECTED: 's:handoff.rejected',
  OWNERSHIP_CHANGED: 's:playback.ownership_changed',
} as const;
export type AccountServerEvent = (typeof AccountServerEvent)[keyof typeof AccountServerEvent];
