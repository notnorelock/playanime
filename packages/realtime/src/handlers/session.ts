import { AccountServerEvent } from '@playanime/contracts';
import { publishRealtimeEvent } from '../pubsub.js';

/**
 * Notifies every socket a user has open (on any API instance) that one of
 * their sessions was revoked. The caller (packages/auth's revoke functions,
 * wired in from packages/api) is responsible for the actual database write
 * — this only fans the event out afterward.
 */
export async function notifySessionRevoked(userId: string, sessionId: string): Promise<void> {
  await publishRealtimeEvent(userId, { type: AccountServerEvent.SESSION_REVOKED, sessionId });
}
