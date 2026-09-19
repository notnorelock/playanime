import type {
  BlogPostCreateBody,
  BlogPostDetailDto,
  BlogPostListPage,
  BlogPostStatus,
  BlogPostUpdateBody,
} from '@playanime/contracts'
import { http } from './client'

/**
 * Platform blog. Public read routes plus an admin-only authoring surface —
 * see `packages/contracts/src/blog/index.ts` for the full design rationale.
 */
export const blogApi = {
  /* ------------------------------------------------------------------ */
  /* Public                                                              */
  /* ------------------------------------------------------------------ */

  list: (cursor?: string, limit = 20, signal?: AbortSignal): Promise<BlogPostListPage> =>
    http.get<BlogPostListPage>('/blog/posts', {
      query: { limit, ...(cursor === undefined ? {} : { cursor }) },
      ...(signal === undefined ? {} : { signal })
    }),

  bySlug: (slug: string, signal?: AbortSignal): Promise<BlogPostDetailDto> =>
    http.get<BlogPostDetailDto>(`/blog/posts/${encodeURIComponent(slug)}`, signal === undefined ? {} : { signal }),

  /* ------------------------------------------------------------------ */
  /* Admin authoring — administrator-only, enforced server-side           */
  /* ------------------------------------------------------------------ */

  adminList: (
    status?: BlogPostStatus,
    cursor?: string,
    limit = 20,
    signal?: AbortSignal
  ): Promise<BlogPostListPage> =>
    http.get<BlogPostListPage>('/blog/admin/posts', {
      query: { limit, ...(status === undefined ? {} : { status }), ...(cursor === undefined ? {} : { cursor }) },
      ...(signal === undefined ? {} : { signal })
    }),

  adminGet: (postId: string, signal?: AbortSignal): Promise<BlogPostDetailDto> =>
    http.get<BlogPostDetailDto>(`/blog/admin/posts/${encodeURIComponent(postId)}`, signal === undefined ? {} : { signal }),

  create: (body: BlogPostCreateBody): Promise<BlogPostDetailDto> =>
    http.post<BlogPostDetailDto>('/blog/admin/posts', { body }),

  update: (postId: string, body: BlogPostUpdateBody): Promise<BlogPostDetailDto> =>
    http.patch<BlogPostDetailDto>(`/blog/admin/posts/${encodeURIComponent(postId)}`, { body }),

  remove: (postId: string): Promise<void> =>
    http.delete<void>(`/blog/admin/posts/${encodeURIComponent(postId)}`)
}
