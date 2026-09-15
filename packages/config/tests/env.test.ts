import { describe, expect, it } from 'bun:test';
import { ConfigurationError, corsOrigins, parseEnv, shouldPrettyPrintLogs } from '../src/index.js';

const valid = {
  NODE_ENV: 'development',
  WEB_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/playanime',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'a'.repeat(48),
} satisfies Record<string, string>;

describe('parseEnv', () => {
  it('accepts a valid development environment and applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.REDIS_NAMESPACE).toBe('playanime');
    expect(env.SESSION_TTL_DAYS).toBe(30);
  });

  it('rejects a missing required variable', () => {
    const { SESSION_SECRET: _omitted, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(ConfigurationError);
  });

  it('reports every issue at once rather than the first', () => {
    try {
      parseEnv({ ...valid, SESSION_SECRET: 'short', DATABASE_URL: 'mysql://x/y' });
      throw new Error('expected a ConfigurationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://localhost:3306/db' })).toThrow();
  });

  it('rejects a short session secret', () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: 'tooshort' })).toThrow();
  });

  it('coerces numeric ports from strings', () => {
    expect(parseEnv({ ...valid, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('parses booleanish flags', () => {
    expect(parseEnv({ ...valid, DATABASE_SSL: 'true' }).DATABASE_SSL).toBe(true);
    expect(parseEnv({ ...valid, DATABASE_SSL: '0' }).DATABASE_SSL).toBe(false);
  });

  it('splits a comma-separated origin list', () => {
    const env = parseEnv({ ...valid, CORS_ORIGINS: 'https://a.example, https://b.example' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('production invariants', () => {
  const prod = {
    ...valid,
    NODE_ENV: 'production',
    WEB_URL: 'https://playani.me',
    API_URL: 'https://api.playani.me',
    DATABASE_URL: 'postgresql://app:s3cret@db.internal:5432/playanime',
    SESSION_SECRET: 'f4a9'.repeat(12),
  };

  it('accepts a well-formed production environment', () => {
    expect(parseEnv(prod).NODE_ENV).toBe('production');
  });

  it('rejects a placeholder session secret', () => {
    expect(() => parseEnv({ ...prod, SESSION_SECRET: `change-me-${'x'.repeat(40)}` })).toThrow();
  });

  it('rejects plaintext http for a public web url', () => {
    expect(() => parseEnv({ ...prod, WEB_URL: 'http://playani.me' })).toThrow();
  });

  it('rejects default database credentials', () => {
    expect(() =>
      parseEnv({ ...prod, DATABASE_URL: 'postgresql://postgres:postgres@db:5432/playanime' }),
    ).toThrow();
  });

  it('allows http on localhost even in production mode', () => {
    expect(() => parseEnv({ ...prod, WEB_URL: 'http://localhost:3000' })).not.toThrow();
  });
});

describe('derived config', () => {
  it('defaults cors origins to the web url', () => {
    expect(corsOrigins(parseEnv(valid))).toEqual(['http://localhost:3000']);
  });

  it('prefers explicit cors origins when present', () => {
    const env = parseEnv({ ...valid, CORS_ORIGINS: 'https://a.example' });
    expect(corsOrigins(env)).toEqual(['https://a.example']);
  });

  it('pretty-prints logs in development but not production', () => {
    expect(shouldPrettyPrintLogs(parseEnv(valid))).toBe(true);
    const prod = parseEnv({
      ...valid,
      NODE_ENV: 'production',
      WEB_URL: 'https://playani.me',
      DATABASE_URL: 'postgresql://app:s3cret@db:5432/x',
      SESSION_SECRET: 'f4a9'.repeat(12),
    });
    expect(shouldPrettyPrintLogs(prod)).toBe(false);
  });
});
