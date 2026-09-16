import { db, DeviceRepository } from '@playanime/database';
import { revokeSessionsByDeviceId } from '@playanime/auth';
import { ConflictError, NotFoundError, now } from '@playanime/shared';
import type { DeviceSummary, SecurityEventSummary } from '@playanime/contracts';

/**
 * Device management — lives under the `auth` module (not a top-level
 * `devices` module) the same way 2FA and Discord linking do: this is a
 * sub-concern of session/account security, not an independent domain.
 */

const repository = new DeviceRepository(db());

function toDeviceSummary(
  row: {
    id: string;
    displayName: string | null;
    deviceType: string;
    browser: string | null;
    os: string | null;
    status: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    activeSessionCount: number;
  },
  currentDeviceId: string | null,
): DeviceSummary {
  return {
    id: row.id,
    displayName: row.displayName,
    deviceType: row.deviceType as DeviceSummary['deviceType'],
    browser: row.browser,
    os: row.os,
    status: row.status as DeviceSummary['status'],
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    isCurrent: row.id === currentDeviceId,
    activeSessionCount: row.activeSessionCount,
  };
}

export async function listDevices(userId: string, currentDeviceId: string | null): Promise<DeviceSummary[]> {
  const rows = await repository.list(userId);
  return rows.map((row) => toDeviceSummary(row, currentDeviceId));
}

/** Throws NotFoundError rather than leaking whether a device id exists for a different user. */
async function findOwnedDevice(userId: string, deviceRowId: string) {
  const device = await repository.findById(deviceRowId);
  if (device?.userId !== userId) {
    throw new NotFoundError('Nie znaleziono tego urządzenia.');
  }
  return device;
}

export async function renameDevice(userId: string, deviceRowId: string, displayName: string) {
  await findOwnedDevice(userId, deviceRowId);
  const updated = await repository.rename(deviceRowId, displayName);
  if (updated === null) throw new NotFoundError('Nie znaleziono tego urządzenia.');

  await repository.recordSecurityEvent({
    actorUserId: userId,
    eventType: 'device_renamed',
    targetId: deviceRowId,
    metadata: { displayName },
  });

  return updated;
}

export async function blockDevice(
  userId: string,
  deviceRowId: string,
  currentDeviceId: string | null,
  reason: string | null,
) {
  await findOwnedDevice(userId, deviceRowId);

  // Blocking the device the caller is using right now would lock them out
  // with no way back in short of a separate session elsewhere.
  if (deviceRowId === currentDeviceId) {
    throw new ConflictError('Nie można zablokować urządzenia, z którego jesteś obecnie zalogowany.');
  }

  const timestamp = now();
  const updated = await repository.block(deviceRowId, reason, timestamp);
  if (updated === null) throw new NotFoundError('Nie znaleziono tego urządzenia.');

  await revokeSessionsByDeviceId(deviceRowId, 'device_blocked');

  await repository.recordSecurityEvent({
    actorUserId: userId,
    eventType: 'device_blocked',
    targetId: deviceRowId,
    metadata: reason === null ? {} : { reason },
  });

  return updated;
}

export async function unblockDevice(userId: string, deviceRowId: string) {
  await findOwnedDevice(userId, deviceRowId);
  const updated = await repository.unblock(deviceRowId);
  if (updated === null) throw new NotFoundError('Nie znaleziono tego urządzenia.');

  await repository.recordSecurityEvent({
    actorUserId: userId,
    eventType: 'device_unblocked',
    targetId: deviceRowId,
  });

  return updated;
}

export async function listSecurityEvents(
  userId: string,
  limit: number,
  cursor: string | undefined,
): Promise<{ items: SecurityEventSummary[]; nextCursor: string | null; hasMore: boolean }> {
  const parsed = cursor === undefined ? null : new Date(cursor);
  const before = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;

  const rows = await repository.securityEventsFor(userId, limit, before);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      eventType: row.eventType as SecurityEventSummary['eventType'],
      targetId: row.targetId,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? (pageRows.at(-1)?.createdAt.toISOString() ?? null) : null,
    hasMore,
  };
}
