import type { DeviceSummary, DeviceType } from '@playanime/contracts';

/**
 * Presentation model for a device.
 *
 * Same reasoning as `models/anime.ts`: the API returns a device with a raw
 * `deviceType` string and ISO timestamps; deciding which icon represents a
 * `deviceType` and how "3 minutes ago" is phrased belongs once here, not
 * recomputed per component.
 */

export interface DeviceCardModel {
  readonly id: string;
  readonly displayName: string;
  readonly deviceType: DeviceType;
  readonly browser: string | null;
  readonly os: string | null;
  readonly isBlocked: boolean;
  readonly isCurrent: boolean;
  readonly activeSessionCount: number;
  readonly lastSeenLabel: string;
}

const DEVICE_TYPE_ICON: Record<DeviceType, string> = {
  desktop: 'Monitor',
  mobile: 'Smartphone',
  tablet: 'Tablet',
  tv: 'Tv',
  unknown: 'HelpCircle',
};

/** Icon component name (this project's icon set, e.g. lucide) for a device's type. */
export function deviceTypeIcon(deviceType: DeviceType): string {
  return DEVICE_TYPE_ICON[deviceType];
}

const RELATIVE_UNITS: readonly { limitSeconds: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limitSeconds: 60, divisor: 1, unit: 'second' },
  { limitSeconds: 3600, divisor: 60, unit: 'minute' },
  { limitSeconds: 86400, divisor: 3600, unit: 'hour' },
  { limitSeconds: 2592000, divisor: 86400, unit: 'day' },
  { limitSeconds: 31536000, divisor: 2592000, unit: 'month' },
];

/** "3 minutes ago", "yesterday" — localized via `Intl.RelativeTimeFormat`. */
export function formatRelativeTime(isoDateTime: string, locale: string): string {
  const then = new Date(isoDateTime).getTime();
  const diffSeconds = Math.round((Date.now() - then) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (diffSeconds < 30) return formatter.format(0, 'second');

  for (const { limitSeconds, divisor, unit } of RELATIVE_UNITS) {
    if (diffSeconds < limitSeconds) return formatter.format(-Math.round(diffSeconds / divisor), unit);
  }

  return formatter.format(-Math.round(diffSeconds / 31536000), 'year');
}

/** A device with no user-chosen name falls back to "Browser on OS", never a blank card. */
function fallbackDisplayName(device: DeviceSummary, unknownLabel: string): string {
  if (device.browser !== null && device.os !== null) return `${device.browser} · ${device.os}`;
  return device.browser ?? device.os ?? unknownLabel;
}

/**
 * A session carries the raw `User-Agent` string, not the parsed
 * `browser`/`os` a device has (only `user_devices` is passed through
 * `ua-parser-js` server-side) — dumping the full string onto a session
 * card is both unreadable and, being one long unbreakable token, capable
 * of overflowing the card. This picks out just the browser name, which is
 * the one thing worth showing without pulling in a second UA parser on
 * the frontend for what is otherwise a secondary field.
 */
const BROWSER_PATTERNS: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /Edg\//, name: 'Edge' },
  { pattern: /OPR\//, name: 'Opera' },
  { pattern: /Chrome\//, name: 'Chrome' },
  { pattern: /Firefox\//, name: 'Firefox' },
  { pattern: /Version\/.*Safari\//, name: 'Safari' },
];

export function summarizeUserAgent(userAgent: string | null, unknownLabel: string): string {
  if (userAgent === null) return unknownLabel;

  for (const { pattern, name } of BROWSER_PATTERNS) {
    if (pattern.test(userAgent)) return name;
  }
  return unknownLabel;
}

export function toDeviceCardModel(device: DeviceSummary, locale: string, unknownLabel: string): DeviceCardModel {
  return {
    id: device.id,
    displayName: device.displayName ?? fallbackDisplayName(device, unknownLabel),
    deviceType: device.deviceType,
    browser: device.browser,
    os: device.os,
    isBlocked: device.status === 'blocked',
    isCurrent: device.isCurrent,
    activeSessionCount: device.activeSessionCount,
    lastSeenLabel: formatRelativeTime(device.lastSeenAt, locale),
  };
}
