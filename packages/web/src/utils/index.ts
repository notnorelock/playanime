/**
 * Utils Index
 * Central export point for all utilities
 */

// Storage utilities
export {
  Storage,
  storage,
  secureStorage,
  createStorage,
  type StorageOptions
} from './storage'

// Role checks, shared with the router guard and the admin views.
export { isAdmin, isModerator, hasRole, isStaff, roleLabel } from './user'
export { getErrorKey, ERROR_CODE_MAP } from './errorCodes'
