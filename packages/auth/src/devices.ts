import { UAParser } from 'ua-parser-js';
import { db, DeviceRepository, type Database, type DeviceSighting } from '@playanime/database';
import type { DeviceType } from '@playanime/contracts';
import { now } from '@playanime/shared';

/**
 * Registered-device tracking.
 *
 * Separate from `packages/auth/src/twofactor/service.ts`'s `trusted_devices`
 * concept, which exists only to skip the 2FA prompt for a while. This is the
 * durable, user-facing "where is my account signed in" identity that
 * `createSession` stamps onto every new session when the caller supplies a
 * `deviceId` — an app-generated UUID the frontend keeps in localStorage, not
 * a fingerprint derived from anything about the browser itself.
 */

/** Maps ua-parser-js's device.type (undefined for desktop) onto our own DeviceType set. */
function toDeviceType(uaDeviceType: string | undefined): DeviceType {
  switch (uaDeviceType) {
    case 'mobile':
      return 'mobile';
    case 'tablet':
      return 'tablet';
    case 'smarttv':
      return 'tv';
    default:
      // ua-parser-js reports undefined for desktop rather than a literal
      // 'desktop' value — a parsed browser+OS with no device.type is the
      // normal desktop case, not an unknown one.
      return uaDeviceType === undefined ? 'desktop' : 'unknown';
  }
}

function parseUserAgent(userAgent: string | undefined): DeviceSighting {
  if (userAgent === undefined || userAgent.length === 0) {
    return { deviceType: 'unknown', browser: null, os: null };
  }

  const parsed = new UAParser(userAgent).getResult();
  return {
    deviceType: toDeviceType(parsed.device.type),
    browser: parsed.browser.name ?? null,
    os: parsed.os.name ?? null,
  };
}

/**
 * Upserts the device a session is being created for, returning its row id
 * to stamp onto `sessions.deviceId` — or null if the caller supplied no
 * `deviceId` at all (an old cached frontend bundle, or a non-browser client).
 */
export async function upsertDeviceForSession(
  userId: string,
  deviceId: string | undefined,
  userAgent: string | undefined,
  database: Database = db(),
): Promise<{ id: string; isNewDevice: boolean } | null> {
  if (deviceId === undefined || deviceId.length === 0) return null;

  const repository = new DeviceRepository(database);
  const existing = await repository.findByDeviceId(userId, deviceId);
  const sighting = parseUserAgent(userAgent);
  const row = await repository.upsertSighting(userId, deviceId, sighting, now());

  return { id: row.id, isNewDevice: existing === null };
}
