import { z } from 'zod';

/**
 * Environment schema.
 *
 * Every variable the platform reads is declared here — `process.env` is not
 * touched anywhere else in the monorepo. That keeps configuration auditable and
 * means a missing variable fails at boot rather than at the first request that
 * happens to need it.
 */

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const port = z.coerce.number().int().min(1).max(65_535);

/** Comma-separated origin list, e.g. "https://playani.me,https://www.playani.me". */
const originList = z
  .string()
  .transform((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean))
  .pipe(z.array(z.url()).min(1));

export const NodeEnv = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof NodeEnv>;

export const envSchema = z
  .object({
    NODE_ENV: NodeEnv.default('development'),

    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: port.default(4000),

    /** Public origin of the web app. Used for CORS and cookie domain. */
    WEB_URL: z.url(),
    /** Public origin of the API, as the browser sees it. */
    API_URL: z.url(),

    DATABASE_URL: z.url().refine((value) => value.startsWith('postgres'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: booleanish.default(false),

    REDIS_URL: z.url().refine((value) => value.startsWith('redis'), {
      message: 'REDIS_URL must be a redis:// or rediss:// connection string',
    }),
    /** Prefix for every Redis key, so environments can share an instance. */
    REDIS_NAMESPACE: z.string().min(1).default('playanime'),

    /**
     * Session cookie signing secret. 32+ bytes of real entropy.
     * Rotating it invalidates every session, which is the intended behaviour
     * after a suspected compromise.
     */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /** Name is environment-scoped so a dev cookie cannot satisfy production. */
    SESSION_COOKIE_NAME: z.string().min(1).default('playanime_session'),

    /** Trusted reverse-proxy hop count for client IP resolution. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    CORS_ORIGINS: originList.optional(),

    RATE_LIMIT_ENABLED: booleanish.default(true),
    MAX_REQUEST_BODY_BYTES: z.coerce.number().int().min(1024).default(1_048_576),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    /** Force structured JSON logs in development when piping to a collector. */
    LOG_PRETTY: booleanish.optional(),

    /**
     * Optional Google API key for the Drive provider's metadata lookups via the
     * official Drive API. Absent means the provider degrades to URL parsing plus
     * an off-site link, which is a supported mode — never a reason to scrape.
     */
    GOOGLE_DRIVE_API_KEY: z.string().min(1).optional(),

    /**
     * Optional DeepL API key, for live English-to-Polish translation of
     * genre/tag names as they're created (an AniList sync, or a
     * translator hand-typing a new one in the authoring form). Absent
     * means a new name is stored without `namePolish` and the UI falls
     * back to the raw English name (`namePolish ?? name`, the same
     * fallback used everywhere already), which is a supported mode — a
     * missing key degrades the feature, it never blocks catalogue
     * authoring.
     */
    DEEPL_API_KEY: z.string().min(1).optional(),

    /**
     * Optional Resend API key, for outbound transactional email — currently
     * only a takedown-report resolution notice to the reporter. Absent means
     * `sendEmail` logs a warning and resolves without sending, the same
     * degrade-not-block behavior as a missing `DEEPL_API_KEY`: a moderator's
     * decision must never fail because email delivery isn't configured.
     */
    RESEND_API_KEY: z.string().min(1).optional(),
    /** The `From` address for outbound email. Required only alongside `RESEND_API_KEY`. */
    RESEND_FROM_ADDRESS: z.string().min(1).optional(),
    /**
     * Where a submitted contact form is sent — deliberately separate from
     * `RESEND_FROM_ADDRESS`, since "who this looks like it's from" and "who
     * actually reads it" are different concerns. Absent means the contact
     * endpoint refuses with a clear error rather than silently discarding
     * the message.
     */
    CONTACT_EMAIL: z.string().min(1).optional(),
    /**
     * The signing secret (`whsec_...`) for Resend's inbound-mail webhook —
     * from the webhook's page in the Resend dashboard once receiving is
     * enabled for the domain. Absent means the webhook endpoint refuses
     * every request rather than trusting an unverifiable one.
     */
    RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),

    /** Enables the source health-check worker. Off by default outside prod. */
    SOURCE_HEALTH_CHECKS_ENABLED: booleanish.default(false),

    /**
     * Discord OAuth. Both present or both absent — `superRefine` below enforces
     * that a client id without a secret (or vice versa) fails at boot rather
     * than at the first login attempt.
     */
    DISCORD_CLIENT_ID: z.string().min(1).optional(),
    DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Production-only invariants that a schema alone cannot express.
    if (env.SESSION_SECRET.includes('change-me') || env.SESSION_SECRET.includes('development')) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET still holds a development placeholder.',
      });
    }

    if (env.WEB_URL.startsWith('http://') && !env.WEB_URL.includes('localhost')) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_URL'],
        message: 'WEB_URL must use https in production; session cookies are Secure-only.',
      });
    }

    if (env.DATABASE_URL.includes('postgres:postgres@')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL uses default development credentials.',
      });
    }
  })
  .superRefine((env, ctx) => {
    if ((env.DISCORD_CLIENT_ID === undefined) !== (env.DISCORD_CLIENT_SECRET === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISCORD_CLIENT_ID'],
        message: 'DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must both be set or both be absent.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
