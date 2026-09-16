/**
 * Pagination Types
 * Shared types for API pagination across all resources
 */

export interface PaginationMeta {
  page: number
  limit: number
  total_count: number
  total_pages: number
}

export interface PaginationParams {
  page?: number
  limit?: number
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationMeta
}

/**
 * Backend Pagination Types
 * Types matching the exact structure returned by the Go backend
 */

export interface BackendPagination {
  page: number
  limit: number
  total_count: number
  total_pages: number
}

export interface BackendPaginatedResponse<T> {
  data: T[]
  pagination: BackendPagination
}

// Helper to create default pagination params
export function defaultPaginationParams(page = 1, limit = 20): Required<PaginationParams> {
  return { page, limit }
}

// Helper to calculate if there's a next page
export function hasNextPage(meta: PaginationMeta): boolean {
  return meta.page < meta.total_pages
}

// Helper to calculate if there's a previous page
export function hasPrevPage(meta: PaginationMeta): boolean {
  return meta.page > 1
}
