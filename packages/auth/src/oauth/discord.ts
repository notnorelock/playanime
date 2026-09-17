import { env } from '@playanime/config';
import { AppError, ErrorCode, ServiceUnavailableError } from '@playanime/shared';

/**
 * Discord OAuth2 client.
 *
 * Talks to Discord directly rather than through a generic OAuth library: the
 * whole exchange is three HTTP calls, and a dependency buys little over that.
 */

const AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

/** Identify: username and avatar. Email: for account matching and login. */
const SCOPES = 'identify email';

export interface DiscordCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Reads Discord credentials from the environment. Null when Discord login is not configured. */
export function discordCredentials(): DiscordCredentials | null {
  const config = env();
  if (config.DISCORD_CLIENT_ID === undefined || config.DISCORD_CLIENT_SECRET === undefined) {
    return null;
  }
  return { clientId: config.DISCORD_CLIENT_ID, clientSecret: config.DISCORD_CLIENT_SECRET };
}

/**
 * The callback URL registered in Discord's application settings.
 *
 * `API_URL` is always the bare public origin of the API (`http://localhost:4000`
 * in dev, `https://playani.me` in production) — both `.env.example` and
 * `.env.prod.example` document "<API_URL>/api/v1/auth/discord/callback" as
 * the URI to register with Discord, so the `/api` prefix belongs here, not
 * folded into `API_URL` itself. (`.env.prod.example` previously set
 * `API_URL=https://playani.me/api`, which doubled this into
 * `/api/api/v1/...` — fixed there, not here, so `API_URL` keeps one
 * consistent meaning across environments.)
 */
export function discordRedirectUri(): string {
  return `${env().API_URL}/api/v1/auth/discord/callback`;
}

/** Builds the URL the browser is redirected to, carrying our CSRF `state`. */
export function discordAuthorizeUrl(state: string): string {
  const credentials = discordCredentials();
  if (credentials === null) {
    throw new ServiceUnavailableError('Logowanie przez Discord jest niedostępne.', { expose: true });
  }

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: discordRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    state,
    prompt: 'consent',
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface DiscordTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date;
}

export interface DiscordProfile {
  readonly id: string;
  readonly username: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly avatarUrl: string | null;
}

/** Exchanges an authorization code for tokens. */
export async function exchangeDiscordCode(code: string): Promise<DiscordTokens> {
  const credentials = discordCredentials();
  if (credentials === null) {
    throw new ServiceUnavailableError('Logowanie przez Discord jest niedostępne.', { expose: true });
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: discordRedirectUri(),
    }),
  });

  if (!response.ok) {
    throw new AppError('Nie udało się połączyć z Discordem.', {
      status: 502,
      code: ErrorCode.OAUTH_PROVIDER_ERROR,
      expose: true,
    });
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
  };
}

/** Fetches the authenticated user's Discord profile. */
export async function fetchDiscordProfile(accessToken: string): Promise<DiscordProfile> {
  const response = await fetch(USER_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new AppError('Nie udało się pobrać profilu Discord.', {
      status: 502,
      code: ErrorCode.OAUTH_PROVIDER_ERROR,
      expose: true,
    });
  }

  const body = (await response.json()) as {
    id: string;
    username: string;
    email: string | null;
    verified?: boolean;
    avatar: string | null;
  };

  return {
    id: body.id,
    username: body.username,
    email: body.email,
    emailVerified: body.verified ?? false,
    avatarUrl:
      body.avatar === null
        ? null
        : `https://cdn.discordapp.com/avatars/${body.id}/${body.avatar}.png?size=256`,
  };
}
