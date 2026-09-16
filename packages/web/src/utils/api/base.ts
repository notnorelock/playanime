/**
 * Base API Class
 * Abstract base class for API resource handlers
 */

import type { AxiosInstance } from 'axios'

export abstract class APIResource {
  protected client: AxiosInstance

  constructor(client: AxiosInstance) {
    this.client = client
  }

  /**
   * Execute API command
   * @param command Command name (method name on the resource class)
   * @param args Arguments to pass to the command
   */
  async execute<T = any>(command: string, ...args: any[]): Promise<T> {
    const method = (this as any)[command]

    if (typeof method !== 'function') {
      throw new Error(`Command '${command}' not found on ${this.constructor.name}`)
    }

    return method.call(this, ...args)
  }
}
