import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { DeviceType } from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { userDevices } from '../schema/devices.js';
import { sessions } from '../schema/auth.js';
import { securityEvents } from '../schema/security.js';

export interface DeviceSighting {
  deviceType?: DeviceType;
  browser?: string | null;
  os?: string | null;
}

export interface SecurityEventEntry {
  actorUserId: string | null;
  eventType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export class DeviceRepository {
  constructor(private readonly db: Database) {}

  /**
   * Records a sighting of a device for a user: creates the row on first
   * sighting, refreshes `lastSeenAt`/`browser`/`os`/`deviceType` on every
   * later one. `coalesce` on the parsed fields means a sighting that failed
   * to parse a browser/OS (an unusual or missing user agent) never blanks
   * out a value a previous, successful parse already recorded.
   */
  async upsertSighting(userId: string, deviceId: string, sighting: DeviceSighting, timestamp: Date) {
    const [row] = await this.db
      .insert(userDevices)
      .values({
        userId,
        deviceId,
        deviceType: sighting.deviceType ?? 'unknown',
        browser: sighting.browser ?? null,
        os: sighting.os ?? null,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [userDevices.userId, userDevices.deviceId],
        set: {
          lastSeenAt: timestamp,
          browser: sql`coalesce(${sighting.browser ?? null}, ${userDevices.browser})`,
          os: sql`coalesce(${sighting.os ?? null}, ${userDevices.os})`,
          ...(sighting.deviceType === undefined ? {} : { deviceType: sighting.deviceType }),
        },
      })
      .returning();
    if (row === undefined) throw new Error('upsertSighting: insert returned no row');
    return row;
  }

  async findByDeviceId(userId: string, deviceId: string) {
    const [row] = await this.db
      .select()
      .from(userDevices)
      .where(and(eq(userDevices.userId, userId), eq(userDevices.deviceId, deviceId)))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(userDevices).where(eq(userDevices.id, id)).limit(1);
    return row ?? null;
  }

  /** One row per device, with how many of its sessions are currently live. */
  async list(userId: string) {
    return this.db
      .select({
        id: userDevices.id,
        deviceId: userDevices.deviceId,
        displayName: userDevices.displayName,
        deviceType: userDevices.deviceType,
        browser: userDevices.browser,
        os: userDevices.os,
        status: userDevices.status,
        firstSeenAt: userDevices.firstSeenAt,
        lastSeenAt: userDevices.lastSeenAt,
        activeSessionCount: sql<number>`count(${sessions.id}) filter (where ${sessions.revokedAt} is null and ${sessions.expiresAt} > now())::integer`,
      })
      .from(userDevices)
      .leftJoin(sessions, eq(sessions.deviceId, userDevices.id))
      .where(eq(userDevices.userId, userId))
      .groupBy(userDevices.id)
      .orderBy(desc(userDevices.lastSeenAt));
  }

  async rename(id: string, displayName: string) {
    const [row] = await this.db
      .update(userDevices)
      .set({ displayName })
      .where(eq(userDevices.id, id))
      .returning();
    return row ?? null;
  }

  async block(id: string, reason: string | null, timestamp: Date) {
    const [row] = await this.db
      .update(userDevices)
      .set({ status: 'blocked', blockedAt: timestamp, blockedReason: reason })
      .where(eq(userDevices.id, id))
      .returning();
    return row ?? null;
  }

  async unblock(id: string) {
    const [row] = await this.db
      .update(userDevices)
      .set({ status: 'active', blockedAt: null, blockedReason: null })
      .where(eq(userDevices.id, id))
      .returning();
    return row ?? null;
  }

  /** Same `limit + 1` / `before` cursor shape as `NotificationRepository.list`. */
  securityEventsFor(userId: string, limit: number, before: Date | null) {
    return this.db
      .select()
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.actorUserId, userId),
          before === null ? undefined : lt(securityEvents.createdAt, before),
        ),
      )
      .orderBy(desc(securityEvents.createdAt))
      .limit(limit + 1);
  }

  /**
   * Appends a security-event row. This table's equivalent of
   * `AdminRepository.audit()` — a different table with a different
   * actor/target shape (self-service, not moderator-on-target), so it does
   * not live on `AdminRepository`. Never pass a raw session token or any
   * other secret in `metadata` — this log may be shown back to the user.
   */
  async recordSecurityEvent(entry: SecurityEventEntry) {
    await this.db.insert(securityEvents).values({
      actorUserId: entry.actorUserId,
      eventType: entry.eventType,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    });
  }
}
