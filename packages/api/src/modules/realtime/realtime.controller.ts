import { Elysia, t } from 'elysia';
import { AccountClientEvent, AccountServerEvent } from '@playanime/contracts';
import { registerSocket, subscribeUserChannel, unregisterSocket, unsubscribeUserChannel } from '@playanime/realtime';
import type { AccountEventHandler } from '@playanime/realtime';
import { sessionContext, type RequestSession } from '../../plugins/session.js';

/**
 * Account-realtime WebSocket: session-revocation and (later) playback-handoff
 * signaling. Mounted at `/api/v1/ws` — see `packages/web/src/services` for
 * the frontend client, and `packages/realtime/README.md` for why this is a
 * thin route delegating to that package rather than owning the logic here.
 *
 * Authentication reuses `sessionContext` exactly as HTTP routes do: the
 * upgrade request carries the session cookie, `sessionContext`'s global
 * `derive` resolves it the same way, and a connection with no valid session
 * is rejected before anything is registered.
 */

// One handler closure per open socket, so unsubscribeUserChannel can remove
// exactly this socket's handler (not some other socket's) when it closes.
const handlersBySessionId = new Map<string, AccountEventHandler>();

export const realtimeController = new Elysia()
  .use(sessionContext)
  .ws('/ws', {
    body: t.Object({
      type: t.Literal(AccountClientEvent.PING),
      sentAt: t.Integer(),
    }),
    open(ws) {
      const session = (ws.data as { session: RequestSession | null }).session;
      if (session === null) {
        ws.close(4401, 'unauthenticated');
        return;
      }

      registerSocket(session.sessionId, ws);

      const handler: AccountEventHandler = (event) => {
        ws.send(event);

        // SESSION_REVOKED force-closes only the socket for the session that
        // was actually revoked — revoking one device must not disconnect
        // this user's other live devices. Every other event type (added as
        // AccountServerMessage grows — see Part 2's handoff events) is just
        // forwarded above, with no further action here.
        const isOwnSessionRevoked =
          event.type === AccountServerEvent.SESSION_REVOKED && event.sessionId === session.sessionId;
        if (isOwnSessionRevoked) {
          ws.close(4001, 'session revoked');
        }
      };
      handlersBySessionId.set(session.sessionId, handler);
      void subscribeUserChannel(session.user.id, handler);
    },
    message(ws, message) {
      const session = (ws.data as { session: RequestSession | null }).session;
      if (session === null) return;

      // The body schema only accepts PING today — extended to a real union
      // (with a discriminated switch here) once Part 2 adds handoff client
      // messages.
      ws.send({ type: AccountServerEvent.PONG, sentAt: message.sentAt });
    },
    close(ws) {
      const session = (ws.data as { session: RequestSession | null }).session;
      if (session === null) return;

      unregisterSocket(session.sessionId);

      const handler = handlersBySessionId.get(session.sessionId);
      handlersBySessionId.delete(session.sessionId);
      if (handler !== undefined) {
        void unsubscribeUserChannel(session.user.id, handler);
      }
    },
  });
