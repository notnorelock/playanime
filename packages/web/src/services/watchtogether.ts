/**
 * Watch Together Service
 * Manages watch together rooms, player sync, and chat
 */

import { ref, computed, type Ref } from 'vue'
import { getWebSocketClient, type WebSocketClient } from './websocket'

// Types
export interface WatchRoom {
  roomId: string
  animeId: number
  episodeId: number
  host: number
  members: Record<number, RoomMember>
  playerState: PlayerState
  chatHistory: ChatMessage[]
}

export interface RoomMember {
  userId: number
  username: string
  avatar?: string
  isGuest: boolean
  joinedAt: string
}

export interface PlayerState {
  playing: boolean
  currentTime: number
  lastUpdated: string
  lastUpdatedBy: number
}

export interface ChatMessage {
  id: string
  userId: number
  username: string
  message: string
  timestamp: string
}

export interface RoomInfo {
  roomId: string
  animeId: number
  episodeId: number
  memberCount: number
  host: number
  createdAt: string
}

export interface AuthResult {
  authenticated: boolean
  isGuest: boolean
  user?: {
    id: number
    username: string
    avatar?: string
  }
}

// Watch Together Manager
export class WatchTogetherManager {
  private ws: WebSocketClient
  private _currentRoom: Ref<WatchRoom | null> = ref(null)
  private _isConnected: Ref<boolean> = ref(false)
  private _isAuthenticated: Ref<boolean> = ref(false)
  private _currentUser: Ref<AuthResult['user'] | null> = ref(null)
  private _isGuest: Ref<boolean> = ref(false)
  private _latency: Ref<number> = ref(0) // Network latency in milliseconds
  private _lastPingTime: number = 0

  // Event handlers
  public onMemberJoined: ((member: RoomMember) => void) | null = null
  public onMemberLeft: ((userId: number) => void) | null = null
  public onHostChanged: ((newHost: number) => void) | null = null
  public onPlayerSync: ((state: Omit<PlayerState, 'lastUpdated' | 'lastUpdatedBy'> & { updatedBy: number }) => void) | null = null
  public onChatMessage: ((message: ChatMessage) => void) | null = null

  constructor(wsUrl?: string) {
    this.ws = getWebSocketClient(wsUrl)
    this.setupWebSocketHandlers()
  }

  // Getters
  get currentRoom() {
    return this._currentRoom
  }

  get isConnected() {
    return this._isConnected
  }

  get isAuthenticated() {
    return this._isAuthenticated
  }

  get currentUser() {
    return this._currentUser
  }

  get isGuest() {
    return this._isGuest
  }

  get isHost() {
    return computed(() => {
      if (!this._currentRoom.value || !this._currentUser.value) {
        return false
      }
      return this._currentRoom.value.host === this._currentUser.value.id
    })
  }

  get latency() {
    return this._latency
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    this.ws.onConnected = () => {
      this._isConnected.value = true
      console.log('[WatchTogether] Connected')
    }

    this.ws.onDisconnected = () => {
      this._isConnected.value = false
      this._isAuthenticated.value = false
      this._currentRoom.value = null
      console.log('[WatchTogether] Disconnected')
    }

    this.ws.onError = (error) => {
      console.error('[WatchTogether] Error:', error)
    }

    // Register notification handlers
    this.ws.on('wt.memberJoined', (params) => {
      if (this._currentRoom.value && params.roomId === this._currentRoom.value.roomId) {
        this._currentRoom.value.members[params.member.userId] = params.member
        if (this.onMemberJoined) {
          this.onMemberJoined(params.member)
        }
      }
    })

    this.ws.on('wt.memberLeft', (params) => {
      if (this._currentRoom.value && params.roomId === this._currentRoom.value.roomId) {
        delete this._currentRoom.value.members[params.userId]
        if (this.onMemberLeft) {
          this.onMemberLeft(params.userId)
        }
      }
    })

    this.ws.on('wt.hostChanged', (params) => {
      if (this._currentRoom.value && params.roomId === this._currentRoom.value.roomId) {
        this._currentRoom.value.host = params.newHost
        if (this.onHostChanged) {
          this.onHostChanged(params.newHost)
        }
      }
    })

    this.ws.on('wt.playerSync', (params) => {
      if (this._currentRoom.value && params.roomId === this._currentRoom.value.roomId) {
        this._currentRoom.value.playerState = {
          playing: params.playing,
          currentTime: params.currentTime,
          lastUpdated: new Date().toISOString(),
          lastUpdatedBy: params.updatedBy,
        }
        if (this.onPlayerSync) {
          this.onPlayerSync({
            playing: params.playing,
            currentTime: params.currentTime,
            updatedBy: params.updatedBy,
          })
        }
      }
    })

    this.ws.on('wt.chatMessage', (params) => {
      if (this._currentRoom.value) {
        this._currentRoom.value.chatHistory.push(params)
        if (this.onChatMessage) {
          this.onChatMessage(params)
        }
      }
    })
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this._isConnected.value) {
      return
    }
    await this.ws.connect()
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.ws.disconnect()
  }

  /**
   * Authenticate with JWT token or as guest
   */
  async authenticate(token?: string): Promise<AuthResult> {
    const result = await this.ws.request<AuthResult>('wt.auth', { token })
    this._isAuthenticated.value = result.authenticated
    this._isGuest.value = result.isGuest
    this._currentUser.value = result.user || null
    return result
  }

  /**
   * Create or join a watch together room
   */
  async joinRoom(params: {
    roomId: string
    animeId: number
    episodeId: number
    username?: string // Required for guests
  }): Promise<WatchRoom> {
    const room = await this.ws.request<WatchRoom>('wt.join', params)
    this._currentRoom.value = room
    return room
  }

  /**
   * Leave the current watch together room
   */
  async leaveRoom(): Promise<void> {
    if (!this._currentRoom.value) {
      return
    }
    await this.ws.request('wt.leave', { roomId: this._currentRoom.value.roomId })
    this._currentRoom.value = null
  }

  /**
   * Sync player state (play/pause/seek)
   */
  async syncPlayer(playing: boolean, currentTime: number): Promise<void> {
    if (!this._currentRoom.value) {
      throw new Error('Not in a room')
    }
    await this.ws.request('wt.sync', {
      roomId: this._currentRoom.value.roomId,
      playing,
      currentTime,
    })
  }

  /**
   * Send chat message
   */
  async sendChatMessage(message: string): Promise<ChatMessage> {
    if (!this._currentRoom.value) {
      throw new Error('Not in a room')
    }
    const result = await this.ws.request<{ success: boolean; message: ChatMessage }>('wt.chat', {
      roomId: this._currentRoom.value.roomId,
      message,
    })
    return result.message
  }

  /**
   * List available rooms
   */
  async listRooms(filters?: { animeId?: number; episodeId?: number }): Promise<RoomInfo[]> {
    const result = await this.ws.request<{ rooms: RoomInfo[] }>('wt.list', filters)
    return result.rooms
  }

  /**
   * Get detailed info about a room
   */
  async getRoomInfo(roomId: string): Promise<WatchRoom> {
    return await this.ws.request<WatchRoom>('wt.roomInfo', { roomId })
  }

  /**
   * Measure network latency with ping-pong
   */
  async ping(): Promise<number> {
    this._lastPingTime = Date.now()
    await this.ws.request('wt.ping', {})
    // Calculate latency from round-trip time
    const rtt = Date.now() - this._lastPingTime
    this._latency.value = Math.round(rtt / 2) // One-way latency
    console.log('[WatchTogether] Latency:', this._latency.value, 'ms (RTT:', rtt, 'ms)')
    return this._latency.value
  }
}

// Singleton instance
let wtManager: WatchTogetherManager | null = null

/**
 * Get or create WatchTogetherManager instance
 */
export function useWatchTogether(wsUrl?: string): WatchTogetherManager {
  if (!wtManager) {
    wtManager = new WatchTogetherManager(wsUrl)
  }
  return wtManager
}

/**
 * Reset WatchTogetherManager instance (useful for testing)
 */
export function resetWatchTogether(): void {
  if (wtManager) {
    wtManager.disconnect()
    wtManager = null
  }
}
