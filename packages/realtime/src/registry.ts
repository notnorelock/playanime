/**
 * In-process socket registry.
 *
 * A live WebSocket handle cannot cross a process boundary — only Redis
 * pub/sub can fan an event out to another API instance. This registry is
 * what lets *this* instance answer "do I hold a socket for this session,"
 * after `pubsub.ts` has delivered an event meant for a user who might be
 * connected here, elsewhere, or not at all.
 */

// Kept loose (not the concrete Elysia WS type) so this package stays
// framework-agnostic — packages/api owns the actual socket type and only
// needs `send`/`close` here.
export interface RegisteredSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const socketsBySessionId = new Map<string, RegisteredSocket>();

export function registerSocket(sessionId: string, socket: RegisteredSocket): void {
  socketsBySessionId.set(sessionId, socket);
}

export function unregisterSocket(sessionId: string): void {
  socketsBySessionId.delete(sessionId);
}

export function getSocket(sessionId: string): RegisteredSocket | undefined {
  return socketsBySessionId.get(sessionId);
}
