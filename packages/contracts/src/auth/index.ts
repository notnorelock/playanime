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

/** App-generated, not a fingerprint — see `useDeviceId` on the frontend. Optional so an old cached bundle that omits it still logs in; the session is simply left with no device association. */
const DeviceIdField = Type.Optional(Type.String({ minLength: 1, maxLength: 128 }));

/** The Cloudflare Turnstile widget's response token, verified server-side before the request is trusted. */
const TurnstileTokenField = Type.String({ minLength: 1, maxLength: 2048 });

export const RegisterBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  username: Type.String({ minLength: 3, maxLength: 32, pattern: '^[a-zA-Z0-9_]+$' }),
  password: Type.String({ minLength: 12, maxLength: 128 }),
  deviceId: DeviceIdField,
  turnstileToken: TurnstileTokenField,
});
export type RegisterBody = Static<typeof RegisterBody>;

/** The 6-digit code emailed on registration. */
export const VerifyEmailBody = Type.Object({
  code: Type.String({ minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' }),
});
export type VerifyEmailBody = Static<typeof VerifyEmailBody>;

export const VerifyEmailResponse = Type.Object({
  verified: Type.Boolean(),
});
export type VerifyEmailResponse = Static<typeof VerifyEmailResponse>;

export const ResendVerificationResponse = Type.Object({
  message: Type.String(),
});
export type ResendVerificationResponse = Static<typeof ResendVerificationResponse>;

export const LoginBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  password: Type.String({ minLength: 1, maxLength: 128 }),
  deviceId: DeviceIdField,
});
export type LoginBody = Static<typeof LoginBody>;

export const SessionResponse = Type.Object({ user: SessionUser });
export type SessionResponse = Static<typeof SessionResponse>;

/**
 * What `POST /auth/login` returns. A password check that passes on a 2FA
 * account does not get a session — only a short-lived challenge token, which
 * `POST /auth/2fa/verify` exchanges for one after a correct code. Callers
 * branch on `kind`; there is deliberately no shared "logged in?" boolean to
 * check instead, since that is exactly the field a client could get wrong.
 */
export const LoginResponse = Type.Union([
  Type.Object({ kind: Type.Literal('authenticated'), user: SessionUser }),
  Type.Object({ kind: Type.Literal('two_factor_required'), challengeToken: Type.String() }),
]);
export type LoginResponse = Static<typeof LoginResponse>;

/* -------------------------------------------------------------------------- */
/* Two-factor authentication                                                   */
/* -------------------------------------------------------------------------- */

/** Returned once, when setup starts. The secret is never sent again — only its encrypted form is stored. */
export const TwoFactorSetupResponse = Type.Object({
  /** Base32 secret, for typing in by hand when a camera is not an option. */
  secret: Type.String(),
  /** `otpauth://` URI, rendered as a QR code by the client. */
  otpauthUri: Type.String(),
});
export type TwoFactorSetupResponse = Static<typeof TwoFactorSetupResponse>;

export const TwoFactorConfirmBody = Type.Object({
  code: Type.String({ pattern: '^[0-9]{6}$' }),
});
export type TwoFactorConfirmBody = Static<typeof TwoFactorConfirmBody>;

/** Shown once, immediately after confirming setup — never retrievable again, only regeneratable. */
export const TwoFactorConfirmResponse = Type.Object({
  recoveryCodes: Type.Array(Type.String()),
});
export type TwoFactorConfirmResponse = Static<typeof TwoFactorConfirmResponse>;

export const TwoFactorVerifyBody = Type.Object({
  challengeToken: Type.String({ minLength: 1 }),
  /** A 6-digit TOTP code, or one of the recovery codes issued at setup. */
  code: Type.String({ minLength: 6, maxLength: 20 }),
  /** Skips the challenge on this browser for a while; sets a separate long-lived cookie. */
  rememberDevice: Type.Optional(Type.Boolean()),
  deviceId: DeviceIdField,
});
export type TwoFactorVerifyBody = Static<typeof TwoFactorVerifyBody>;

export const TwoFactorDisableBody = Type.Object({
  password: Type.String({ minLength: 1, maxLength: 128 }),
});
export type TwoFactorDisableBody = Static<typeof TwoFactorDisableBody>;

export const TwoFactorStatus = Type.Object({
  enabled: Type.Boolean(),
  /** How many one-time recovery codes are left unused. */
  recoveryCodesRemaining: Type.Integer({ minimum: 0 }),
});
export type TwoFactorStatus = Static<typeof TwoFactorStatus>;

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
  /** Null for sessions created before device tracking existed, or when the login omitted a deviceId. */
  deviceId: Type.Union([Uuid, Type.Null()]),
});
export type SessionSummary = Static<typeof SessionSummary>;
