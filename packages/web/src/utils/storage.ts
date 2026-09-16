/**
 * Advanced Storage Utility
 * Extended localStorage wrapper with type safety, encryption, and expiration
 * @module utils/storage
 */

/**
 * Storage options
 */
export interface StorageOptions<T> {
  /**
   * Prefix for all keys
   */
  prefix?: string

  /**
   * Default value if key doesn't exist
   */
  defaultValue?: T

  /**
   * Expiration time in milliseconds (0 = no expiration)
   */
  expiresIn?: number

  /**
   * Serialize function (default: JSON.stringify)
   */
  serialize?: (value: T) => string

  /**
   * Deserialize function (default: JSON.parse)
   */
  deserialize?: (value: string) => T

  /**
   * Whether to encrypt the value (basic obfuscation, not secure encryption)
   */
  encrypt?: boolean
}

/**
 * Stored value wrapper with metadata
 */
interface StoredValue<T> {
  value: T
  timestamp: number
  expiresAt?: number
}

/**
 * Advanced Storage Class
 * Provides type-safe, feature-rich localStorage management
 */
export class Storage<T = any> {
  private prefix: string
  private defaultValue?: T
  private expiresIn: number
  private serialize: (value: T) => string
  private deserialize: (value: string) => T
  private encrypt: boolean

  constructor(options: StorageOptions<T> = {}) {
    this.prefix = options.prefix || 'app_'
    this.defaultValue = options.defaultValue
    this.expiresIn = options.expiresIn || 0
    this.serialize = options.serialize || JSON.stringify
    this.deserialize = options.deserialize || JSON.parse
    this.encrypt = options.encrypt || false
  }

  /**
   * Get the full key with prefix
   */
  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }

  /**
   * Simple XOR encryption for obfuscation (NOT cryptographically secure)
   */
  private encryptValue(value: string): string {
    const key = 'playanime_secret_key' // In production, use a proper encryption library
    let result = ''
    for (let i = 0; i < value.length; i++) {
      result += String.fromCharCode(value.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return btoa(result) // Base64 encode
  }

  /**
   * Simple XOR decryption
   */
  private decryptValue(value: string): string {
    try {
      const decoded = atob(value) // Base64 decode
      const key = 'playanime_secret_key'
      let result = ''
      for (let i = 0; i < decoded.length; i++) {
        result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length))
      }
      return result
    } catch {
      return value // Return as-is if decryption fails
    }
  }

  /**
   * Get a value from localStorage
   */
  get(key: string): T | undefined {
    try {
      const fullKey = this.getKey(key)
      let rawValue = localStorage.getItem(fullKey)

      if (rawValue === null) {
        return this.defaultValue
      }

      // Decrypt if enabled
      if (this.encrypt) {
        rawValue = this.decryptValue(rawValue)
      }

      const stored: StoredValue<T> = JSON.parse(rawValue)

      // Check expiration
      if (stored.expiresAt && Date.now() > stored.expiresAt) {
        this.remove(key)
        return this.defaultValue
      }

      return stored.value
    } catch (error) {
      console.error(`Failed to get key "${key}":`, error)
      return this.defaultValue
    }
  }

  /**
   * Set a value in localStorage
   */
  set(key: string, value: T, expiresIn?: number): void {
    try {
      const fullKey = this.getKey(key)
      const expires = expiresIn !== undefined ? expiresIn : this.expiresIn

      const stored: StoredValue<T> = {
        value,
        timestamp: Date.now(),
        expiresAt: expires > 0 ? Date.now() + expires : undefined
      }

      let rawValue = JSON.stringify(stored)

      // Encrypt if enabled
      if (this.encrypt) {
        rawValue = this.encryptValue(rawValue)
      }

      localStorage.setItem(fullKey, rawValue)
    } catch (error) {
      console.error(`Failed to set key "${key}":`, error)
    }
  }

  /**
   * Remove a value from localStorage
   */
  remove(key: string): void {
    try {
      const fullKey = this.getKey(key)
      localStorage.removeItem(fullKey)
    } catch (error) {
      console.error(`Failed to remove key "${key}":`, error)
    }
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  /**
   * Clear all keys with this prefix
   */
  clear(): void {
    try {
      const keys = Object.keys(localStorage)
      const prefix = this.getKey('')

      keys.forEach(key => {
        if (key.startsWith(prefix)) {
          localStorage.removeItem(key)
        }
      })
    } catch (error) {
      console.error('Failed to clear storage:', error)
    }
  }

  /**
   * Get all keys with this prefix
   */
  keys(): string[] {
    try {
      const keys = Object.keys(localStorage)
      const prefix = this.getKey('')

      return keys
        .filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length))
    } catch (error) {
      console.error('Failed to get keys:', error)
      return []
    }
  }

  /**
   * Get the size of stored data in bytes
   */
  size(): number {
    try {
      const keys = Object.keys(localStorage)
      const prefix = this.getKey('')

      let totalSize = 0
      keys.forEach(key => {
        if (key.startsWith(prefix)) {
          const value = localStorage.getItem(key)
          if (value) {
            totalSize += key.length + value.length
          }
        }
      })

      return totalSize
    } catch (error) {
      console.error('Failed to calculate size:', error)
      return 0
    }
  }

  /**
   * Get all values with this prefix
   */
  getAll(): Record<string, T> {
    try {
      const keys = this.keys()
      const result: Record<string, T> = {}

      keys.forEach(key => {
        const value = this.get(key)
        if (value !== undefined) {
          result[key] = value
        }
      })

      return result
    } catch (error) {
      console.error('Failed to get all values:', error)
      return {}
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    try {
      const keys = this.keys()

      keys.forEach(key => {
        // Attempt to get the value, which will auto-remove if expired
        this.get(key)
      })
    } catch (error) {
      console.error('Failed to cleanup:', error)
    }
  }
}

/**
 * Create a storage instance with custom options
 */
export function createStorage<T = any>(options: StorageOptions<T> = {}): Storage<T> {
  return new Storage<T>(options)
}

/**
 * Default storage instances
 */
export const storage = new Storage({ prefix: 'app_' })
export const secureStorage = new Storage({ prefix: 'secure_', encrypt: true })

/**
 * Export default
 */
export default storage
