import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, literalUnion, Uuid } from '../common/index.js';

/**
 * Authorization roles, ordered by privilege.
 *
 * Kept as a ranked list so a guard can express "at least moderator" without a
 * scattered set of boolean checks.
 */
export const UserRole = {
  USER: 'user',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const USER_ROLES = Object.values(UserRole);

/** Higher rank outranks lower. Used by the role guard. */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  [UserRole.USER]: 0,
  [UserRole.MODERATOR]: 10,
  [UserRole.ADMIN]: 20,
};

export const hasAtLeastRole = (actual: UserRole, required: UserRole): boolean =>
  ROLE_RANK[actual] >= ROLE_RANK[required];

/**
 * The authenticated user as the client sees it.
 *
 * Note what is absent: no password hash, no email verification token, no
 * internal flags. This is the whole point of separating contracts from rows.
 */
export const SessionUser = Type.Object({
  id: Uuid,
  email: Type.String({ format: 'email' }),
  username: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String({ format: 'uri' }), Type.Null()]),
  role: literalUnion(USER_ROLES),
  emailVerified: Type.Boolean(),
  createdAt: IsoDateTime,
});
export type SessionUser = Static<typeof SessionUser>;

export const RegisterBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  username: Type.String({ minLength: 3, maxLength: 32, pattern: '^[a-zA-Z0-9_]+$' }),
  password: Type.String({ minLength: 12, maxLength: 128 }),
});
export type RegisterBody = Static<typeof RegisterBody>;

export const LoginBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  password: Type.String({ minLength: 1, maxLength: 128 }),
});
export type LoginBody = Static<typeof LoginBody>;

export const SessionResponse = Type.Object({ user: SessionUser });
export type SessionResponse = Static<typeof SessionResponse>;

/**
 * What the Discord callback hands back to the frontend, as a query string on
 * the redirect back into the web app — never a session token, which stays an
 * HttpOnly cookie set directly by the API.
 */
export const DiscordCallbackOutcome = Type.Union([
  Type.Object({ kind: Type.Literal('signed-in') }),
  Type.Object({ kind: Type.Literal('linked') }),
  Type.Object({
    kind: Type.Literal('pending-signup'),
    pendingSignupToken: Type.String(),
    suggestedUsername: Type.String(),
    email: Type.Union([Type.String(), Type.Null()]),
  }),
]);
export type DiscordCallbackOutcome = Static<typeof DiscordCallbackOutcome>;

/** Finishes a Discord signup a visitor started but had no account for yet. */
export const DiscordCompleteSignupBody = Type.Object({
  pendingSignupToken: Type.String({ minLength: 1 }),
  username: Type.String({ minLength: 3, maxLength: 32, pattern: '^[a-zA-Z0-9_]+$' }),
  email: Type.String({ format: 'email', maxLength: 254 }),
});
export type DiscordCompleteSignupBody = Static<typeof DiscordCompleteSignupBody>;

/** A linked OAuth provider, shown on the account settings page. */
export const LinkedAccountDto = Type.Object({
  provider: Type.String(),
  linkedAt: IsoDateTime,
});
export type LinkedAccountDto = Static<typeof LinkedAccountDto>;

/** A device/session row, for the "where you're signed in" screen. */
export const SessionSummary = Type.Object({
  id: Uuid,
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  expiresAt: IsoDateTime,
  userAgent: Type.Union([Type.String(), Type.Null()]),
  ipAddress: Type.Union([Type.String(), Type.Null()]),
  isCurrent: Type.Boolean(),
});
export type SessionSummary = Static<typeof SessionSummary>;
