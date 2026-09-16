import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, IsoDateTime, literalUnion, Uuid } from '../common/index.js';

export const DeviceType = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  TABLET: 'tablet',
  TV: 'tv',
  UNKNOWN: 'unknown',
} as const;
export type DeviceType = (typeof DeviceType)[keyof typeof DeviceType];
export const DEVICE_TYPES = Object.values(DeviceType);

/** Separate from a session's own revoked/expired lifecycle — blocking a device is an account-owner action independent of any one session. */
export const DeviceStatus = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
} as const;
export type DeviceStatus = (typeof DeviceStatus)[keyof typeof DeviceStatus];
export const DEVICE_STATUSES = Object.values(DeviceStatus);

/**
 * Self-service security events (a user acting on their own session/device),
 * distinct from `ModerationAction` (a moderator acting on someone else's
 * content). Kept as a plain string set rather than a table-level enum — see
 * `security_events.eventType`'s column comment for why.
 */
export const SecurityEventType = {
  SESSION_REVOKED: 'session_revoked',
  SESSION_REVOKED_ALL: 'session_revoked_all',
  DEVICE_BLOCKED: 'device_blocked',
  DEVICE_UNBLOCKED: 'device_unblocked',
  DEVICE_RENAMED: 'device_renamed',
  LOGIN_NEW_DEVICE: 'login_new_device',
} as const;
export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];
export const SECURITY_EVENT_TYPES = Object.values(SecurityEventType);

export const DeviceSummary = Type.Object({
  id: Uuid,
  displayName: Type.Union([Type.String(), Type.Null()]),
  deviceType: literalUnion(DEVICE_TYPES),
  browser: Type.Union([Type.String(), Type.Null()]),
  os: Type.Union([Type.String(), Type.Null()]),
  status: literalUnion(DEVICE_STATUSES),
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  isCurrent: Type.Boolean(),
  activeSessionCount: Type.Integer({ minimum: 0 }),
});
export type DeviceSummary = Static<typeof DeviceSummary>;

/** Plain array, not a cursor page — a device list is small and bounded, same as `AnimeDetail.assets`. */
export const DeviceListResponse = Type.Array(DeviceSummary);
export type DeviceListResponse = Static<typeof DeviceListResponse>;

export const DeviceRenameBody = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 100 }),
});
export type DeviceRenameBody = Static<typeof DeviceRenameBody>;

export const DeviceBlockBody = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 64 })),
});
export type DeviceBlockBody = Static<typeof DeviceBlockBody>;

export const SecurityEventSummary = Type.Object({
  id: Uuid,
  eventType: literalUnion(SECURITY_EVENT_TYPES),
  targetId: Type.Union([Uuid, Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  createdAt: IsoDateTime,
});
export type SecurityEventSummary = Static<typeof SecurityEventSummary>;

/** Genuinely unbounded and growing — unlike the device list, this one is cursor-paginated. */
export const SecurityEventPage = CursorPageOf(SecurityEventSummary);
export type SecurityEventPage = Static<typeof SecurityEventPage>;
