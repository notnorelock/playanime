/**
 * WebSocket JSON-RPC 2.0 Client
 * Manages WebSocket connection and JSON-RPC communication with backend
 */

export interface RPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: any
  id: number | string
}

export interface RPCResponse {
  jsonrpc: '2.0'
  result?: any
  error?: RPCError
  id: number | string
}

export interface RPCError {
  code: number
  message: string
  data?: any
}

export interface RPCNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

type RequestCallback = (error: RPCError | null, result?: any) => void
type NotificationHandler = (params: any) => void

export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private requestId = 0
  private pendingRequests = new Map<number | string, RequestCallback>()
  private notificationHandlers = new Map<string, Set<NotificationHandler>>()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private reconnectTimer: number | null = null
  private isManualClose = false

  // Connection state callbacks
  public onConnected: (() => void) | null = null
  public onDisconnected: (() => void) | null = null
  public onError: ((error: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.isManualClose = false
        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
          console.log('[WebSocket] Connected to', this.url)
          this.reconnectAttempts = 0
          if (this.onConnected) {
            this.onConnected()
          }
          resolve()
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }

        this.ws.onerror = (error) => {
          console.error('[WebSocket] Error:', error)
          if (this.onError) {
            this.onError(error)
          }
          reject(error)
        }

        this.ws.onclose = () => {
          console.log('[WebSocket] Disconnected')
          this.ws = null
          if (this.onDisconnected) {
            this.onDisconnected()
          }

          // Auto-reconnect if not manually closed
          if (!this.isManualClose) {
            this.scheduleReconnect()
          }
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isManualClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    // Clear all pending requests
    this.pendingRequests.clear()
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached')
      return
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts)
    this.reconnectAttempts++

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    this.reconnectTimer = window.setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[WebSocket] Reconnection failed:', error)
      })
    }, delay)
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data)

      // Check if it's a notification (no id field)
      if (!('id' in message) && message.method) {
        this.handleNotification(message as RPCNotification)
        return
      }

      // Handle response
      const response = message as RPCResponse
      const callback = this.pendingRequests.get(response.id)

      if (callback) {
        this.pendingRequests.delete(response.id)
        if (response.error) {
          callback(response.error)
        } else {
          callback(null, response.result)
        }
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error)
    }
  }

  /**
   * Handle notification from server
   */
  private handleNotification(notification: RPCNotification): void {
    const handlers = this.notificationHandlers.get(notification.method)
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(notification.params)
        } catch (error) {
          console.error(`[WebSocket] Error in notification handler for ${notification.method}:`, error)
        }
      })
    }
  }

  /**
   * Send JSON-RPC request
   */
  request<T = any>(method: string, params?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('WebSocket not connected'))
        return
      }

      const id = ++this.requestId
      const request: RPCRequest = {
        jsonrpc: '2.0',
        method,
        params,
        id,
      }

      this.pendingRequests.set(id, (error, result) => {
        if (error) {
          reject(error)
        } else {
          resolve(result)
        }
      })

      try {
        this.ws!.send(JSON.stringify(request))
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  /**
   * Send JSON-RPC notification (no response expected)
   */
  notify(method: string, params?: any): void {
    if (!this.isConnected()) {
      console.warn('[WebSocket] Cannot send notification, not connected')
      return
    }

    const notification: Omit<RPCNotification, 'id'> = {
      jsonrpc: '2.0',
      method,
      params,
    }

    try {
      this.ws!.send(JSON.stringify(notification))
    } catch (error) {
      console.error('[WebSocket] Failed to send notification:', error)
    }
  }

  /**
   * Register handler for server notifications
   */
  on(method: string, handler: NotificationHandler): () => void {
    if (!this.notificationHandlers.has(method)) {
      this.notificationHandlers.set(method, new Set())
    }
    this.notificationHandlers.get(method)!.add(handler)

    // Return unsubscribe function
    return () => {
      const handlers = this.notificationHandlers.get(method)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          this.notificationHandlers.delete(method)
        }
      }
    }
  }

  /**
   * Remove notification handler
   */
  off(method: string, handler: NotificationHandler): void {
    const handlers = this.notificationHandlers.get(method)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.notificationHandlers.delete(method)
      }
    }
  }

  /**
   * Remove all notification handlers for a method
   */
  offAll(method: string): void {
    this.notificationHandlers.delete(method)
  }
}

// Singleton instance
let wsClient: WebSocketClient | null = null

/**
 * Get or create WebSocket client instance
 */
export function getWebSocketClient(url?: string): WebSocketClient {
  if (!wsClient) {
    if (!url) {
      // Default to localhost for development
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsHost = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.hostname}:5555`
      url = `${wsHost}/ws`
    }
    wsClient = new WebSocketClient(url)
  }
  return wsClient
}

/**
 * Reset WebSocket client instance (useful for testing)
 */
export function resetWebSocketClient(): void {
  if (wsClient) {
    wsClient.disconnect()
    wsClient = null
  }
}
