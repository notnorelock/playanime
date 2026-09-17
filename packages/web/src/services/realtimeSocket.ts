import type { AccountClientMessage, AccountServerMessage } from '@playanime/contracts';

/**
 * Account-realtime WebSocket client.
 *
 * Talks to `/api/v1/ws` (see `packages/api/src/modules/realtime/realtime.controller.ts`)
 * using the typed `{ type, ... }` discriminated messages from
 * `@playanime/contracts`'s `AccountClientMessage`/`AccountServerMessage` —
 * not the JSON-RPC 2.0 envelope `services/websocket.ts` speaks, which is a
 * different, still-unbuilt server (the watch-party protocol) on a different
 * port. That file is left alone; this one is this account channel's own
 * client.
 *
 * Authentication is the session cookie, exactly like every `http.*` call —
 * the browser attaches it to the WebSocket upgrade request automatically,
 * so there is nothing to pass here.
 */

type MessageHandler = (message: AccountServerMessage) => void;

const PING_INTERVAL_MS = 20_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 1000;

/** Resolves `VITE_API_URL` (which may be relative, e.g. "/api") against the current origin, then swaps the scheme for ws(s). */
function resolveWsUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl === undefined) {
    throw new Error('VITE_API_URL is not set — see packages/web/.env.example.');
  }

  const resolved = new URL(apiUrl.replace(/\/+$/, ''), window.location.origin);
  resolved.protocol = resolved.protocol === 'https:' ? 'wss:' : 'ws:';
  resolved.pathname = `${resolved.pathname.replace(/\/+$/, '')}/api/v1/ws`;
  resolved.search = '';
  return resolved.toString();
}

class RealtimeSocketClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private manualClose = false;

  connect(): void {
    if (this.ws !== null) return;

    this.manualClose = false;
    const socket = new WebSocket(resolveWsUrl());
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.startPing();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: AccountServerMessage;
      try {
        message = JSON.parse(event.data) as AccountServerMessage;
      } catch {
        return;
      }
      for (const handler of this.handlers) handler(message);
    };

    socket.onclose = () => {
      this.ws = null;
      this.stopPing();
      if (!this.manualClose) this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose always follows onerror for a WebSocket — reconnect scheduling
      // happens there, nothing further to do here.
    };
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.reconnectAttempts = 0;
  }

  /** Subscribes to every server message; returns an unsubscribe function. */
  on(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(message: AccountClientMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private startPing(): void {
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'c:ping', sentAt: Date.now() });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;

    const delay = BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts;
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delay);
  }
}

let client: RealtimeSocketClient | null = null;

export function getRealtimeSocket(): RealtimeSocketClient {
  client ??= new RealtimeSocketClient();
  return client;
}
