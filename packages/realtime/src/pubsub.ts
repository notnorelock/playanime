import { createRedis, redis, redisKeys, type RedisClient } from '@playanime/redis';
import { createLogger } from '@playanime/logger';
import type { AccountServerMessage } from '@playanime/contracts';

const logger = createLogger({ name: 'realtime' });

/**
 * Redis pub/sub fanout for account-realtime events.
 *
 * Publishing needs no dedicated connection — it's a normal command, so it
 * rides the same shared `redis()` client every cache/rate-limit call uses.
 * Subscribing is different: once an ioredis connection issues SUBSCRIBE, it
 * can no longer issue ordinary commands, so it needs its own connection,
 * created lazily on the first actual subscribe rather than at module load
 * (a process that only ever publishes — most API instances, most of the
 * time — should never open this second connection at all).
 */

let subscriberClient: RedisClient | null = null;
let messageListenerAttached = false;

function subscriber(): RedisClient {
  if (subscriberClient === null) {
    subscriberClient = createRedis({ lazyConnect: false });
    attachMessageListener(subscriberClient);
  }
  return subscriberClient;
}

function attachMessageListener(client: RedisClient): void {
  if (messageListenerAttached) return;
  messageListenerAttached = true;

  client.on('message', (channel: string, raw: string) => {
    const entry = subscriptions.get(channel);
    if (entry === undefined) return;

    let event: AccountServerMessage;
    try {
      event = JSON.parse(raw) as AccountServerMessage;
    } catch (error: unknown) {
      logger.warn('Failed to parse realtime pub/sub message', {
        module: 'realtime',
        'data.channel': channel,
        'data.error': String(error),
      });
      return;
    }

    for (const handler of entry.handlers) handler(event);
  });
}

export type AccountEventHandler = (event: AccountServerMessage) => void;

interface ChannelSubscription {
  handlers: Set<AccountEventHandler>;
}

const subscriptions = new Map<string, ChannelSubscription>();

/** Publishes an event to every socket a user currently has open, on any API instance. */
export async function publishRealtimeEvent(userId: string, event: AccountServerMessage): Promise<void> {
  const channel = redisKeys.userRealtimeChannel(userId);
  await redis().publish(channel, JSON.stringify(event));
}

/**
 * Subscribes this process to a user's realtime channel, ref-counted: the
 * underlying Redis SUBSCRIBE only happens the first time this instance
 * holds any socket for that user, and UNSUBSCRIBE only when the last one
 * closes. Without this, an instance with several of one user's sockets open
 * (e.g. two open tabs) would issue redundant subscribes for the same channel.
 */
export async function subscribeUserChannel(userId: string, handler: AccountEventHandler): Promise<void> {
  const channel = redisKeys.userRealtimeChannel(userId);
  const existing = subscriptions.get(channel);

  if (existing !== undefined) {
    existing.handlers.add(handler);
    return;
  }

  const entry: ChannelSubscription = { handlers: new Set([handler]) };
  subscriptions.set(channel, entry);

  await subscriber().subscribe(channel);
}

/** Unsubscribes one handler; only issues the real Redis UNSUBSCRIBE once no handler remains for that channel. */
export async function unsubscribeUserChannel(userId: string, handler: AccountEventHandler): Promise<void> {
  const channel = redisKeys.userRealtimeChannel(userId);
  const entry = subscriptions.get(channel);
  if (entry === undefined) return;

  entry.handlers.delete(handler);
  if (entry.handlers.size > 0) return;

  subscriptions.delete(channel);
  // subscriberClient is guaranteed non-null here: reaching this point means
  // subscribeUserChannel already created it for this same channel.
  await subscriberClient?.unsubscribe(channel);
}
