/**
 * Fields scrubbed from every log line.
 *
 * Logging is the most common way secrets escape a system: a request body gets
 * logged during debugging, and a password lands in a log aggregator that has a
 * far wider audience than the database. Redaction is centralized so no call
 * site can forget it.
 *
 * Pino applies these as paths; wildcards cover nested request/response shapes.
 */
export const REDACTED_PATHS: readonly string[] = [
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'setCookie',

  '*.password',
  '*.passwordHash',
  '*.token',
  '*.secret',

  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'body.password',
  'body.newPassword',
  'body.currentPassword',
  'user.passwordHash',

  // Signed playback URLs are ephemeral and must never land in log aggregators.
  'src',
  '*.src',
  'sources[*].src',
  'streamUrls[*].src',
  'fallback.src',
  'sig',
  '*.sig',
  'signature',
  '*.signature',
];

export const REDACTION_PLACEHOLDER = '[redacted]';
