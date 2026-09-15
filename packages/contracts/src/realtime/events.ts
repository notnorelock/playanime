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
