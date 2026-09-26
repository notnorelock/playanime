import { Elysia, t } from 'elysia';
import {
  BLOG_POST_STATUSES,
  BlogCoverImageUploadResponse,
  BlogPostCreateBody,
  BlogPostUpdateBody,
  literalUnion,
} from '@playanime/contracts';
import { requireAdmin } from '@playanime/auth';
import { UnsupportedMediaTypeError } from '@playanime/shared';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { uploadBlogCoverImage } from '../media/media.service.js';
import {
  createBlogPost,
  deleteBlogPost,
  getAdminBlogPost,
  getPublicBlogPostBySlug,
  listAdminBlogPosts,
  listPublicBlogPosts,
  updateBlogPost,
} from './blog.service.js';

/**
 * Platform blog — public read routes plus an admin-only authoring surface.
 * See `packages/contracts/src/blog/index.ts` for the full design rationale.
 */

const PostIdParams = t.Object({ postId: t.String({ format: 'uuid' }) });
const SlugParams = t.Object({ slug: t.String({ maxLength: 96 }) });
const ListQuery = t.Object({
  cursor: t.Optional(t.String({ maxLength: 512 })),
  limit: t.Optional(t.Numeric()),
});

export const blogController = new Elysia({ prefix: '/blog' })
  .use(sessionContext)

  /* ---------------------------------------------------------------- */
  /* Public                                                             */
  /* ---------------------------------------------------------------- */

  .get(
    '/posts',
    ({ query }) => listPublicBlogPosts(Math.min(query.limit ?? 20, 50), query.cursor),
    {
      query: ListQuery,
      detail: {
        summary: 'Published blog posts',
        description: 'Newest first. Only posts that are published AND whose publishedAt has passed.',
        tags: ['blog'],
      },
    },
  )
  .get(
    '/posts/:slug',
    ({ params }) => getPublicBlogPostBySlug(params.slug),
    {
      params: SlugParams,
      detail: {
        summary: 'One published post, by slug',
        description: '404s for a draft or not-yet-scheduled post, same as a nonexistent one.',
        tags: ['blog'],
      },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Admin authoring — administrators only                              */
  /* ---------------------------------------------------------------- */

  .get(
    '/admin/posts',
    ({ query, session }) => {
      requireAdmin(session);
      return listAdminBlogPosts(query.status, Math.min(query.limit ?? 20, 50), query.cursor);
    },
    {
      query: t.Composite([ListQuery, t.Object({ status: t.Optional(literalUnion(BLOG_POST_STATUSES)) })]),
      detail: {
        summary: 'All blog posts (any status)',
        description: 'Administrator-only. Includes drafts and scheduled posts.',
        tags: ['blog'],
      },
    },
  )
  .get(
    '/admin/posts/:postId',
    ({ params, session }) => {
      requireAdmin(session);
      return getAdminBlogPost(params.postId);
    },
    {
      params: PostIdParams,
      detail: { summary: 'One post for editing, any status', tags: ['blog'] },
    },
  )
  .post(
    '/admin/posts',
    ({ body, session, set }) => {
      const auth = requireAdmin(session);
      set.status = 201;
      return createBlogPost({ actorUserId: auth.user.id }, body);
    },
    {
      body: BlogPostCreateBody,
      detail: {
        summary: 'Create a post',
        description: 'Always created as a draft — publishing is a separate PATCH with status: "published".',
        tags: ['blog'],
      },
    },
  )
  .patch(
    '/admin/posts/:postId',
    ({ params, body, session }) => {
      const auth = requireAdmin(session);
      return updateBlogPost({ actorUserId: auth.user.id }, params.postId, body);
    },
    {
      params: PostIdParams,
      body: BlogPostUpdateBody,
      detail: {
        summary: 'Edit a post, or change its status/schedule',
        description:
          'Setting status to "published" with no explicit publishedAt publishes immediately; an explicit future publishedAt schedules it.',
        tags: ['blog'],
      },
    },
  )
  .delete(
    '/admin/posts/:postId',
    async ({ params, session, set }) => {
      const auth = requireAdmin(session);
      await deleteBlogPost({ actorUserId: auth.user.id }, params.postId);
      set.status = 204;
    },
    {
      params: PostIdParams,
      detail: { summary: 'Permanently delete a post', tags: ['blog'] },
    },
  )
  .use(rateLimit('avatarUpload'))
  .post(
    '/admin/cover-image',
    async ({ body, session, set }) => {
      requireAdmin(session);

      if (!(body.file instanceof File)) {
        throw new UnsupportedMediaTypeError('No file was uploaded.');
      }

      const result = await uploadBlogCoverImage(await body.file.arrayBuffer());
      set.status = 201;
      return result;
    },
    {
      body: t.Object({ file: t.File() }),
      response: BlogCoverImageUploadResponse,
      detail: {
        summary: "Upload a post's cover image",
        description:
          'Converts to WebP and stores it, returning a URL. Does not itself change any post — pass the returned URL to POST/PATCH .../posts as coverImageUrl to actually set it.',
        tags: ['blog'],
      },
    },
  );
