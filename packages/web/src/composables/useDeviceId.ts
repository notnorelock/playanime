import { storage } from '@/utils/storage';

/**
 * This device's identity, as the backend understands it.
 *
 * Deliberately not a browser fingerprint — just an opaque id this app
 * generated once and persists in `localStorage` under the shared `app_`
 * prefix, so it survives logout (a device stays the same device across
 * sign-outs) but is naturally scoped per-browser-profile (two profiles on
 * one machine are two devices, matching how `user_devices` treats them).
 *
 * Not reactive: this is read once per request (login, register, 2FA verify,
 * the realtime socket URL), never rendered, so a plain function is enough.
 */
const DEVICE_ID_KEY = 'device_id';

export function getOrCreateDeviceId(): string {
  const existing = storage.get(DEVICE_ID_KEY) as string | undefined;
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const id = crypto.randomUUID();
  storage.set(DEVICE_ID_KEY, id);
  return id;
}
