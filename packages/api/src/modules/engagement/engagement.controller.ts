import { Elysia, t } from 'elysia';
import {
  CommentCreateBody,
  CommentQuery,
  CommentUpdateBody,
  RatingUpsertBody,
  ReviewCreateBody,
} from '@playanime/contracts';
import { requireAuth, requireVerifiedEmail } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import {
  createComment,
  createReview,
  listComments,
  removeOwnedComment,
  updateOwnedComment,
} from './comments.service.js';
import { getRating, removeRating, saveRating } from './ratings.service.js';

const AnimeParams = t.Object({ slug: t.String({ format: 'uuid' }) });
const CommentParams = t.Object({ commentId: t.String({ format: 'uuid' }) });

export const engagementController = new Elysia()
  .use(sessionContext)
  .get(
    '/anime/:slug/rating',
    ({ params, session }) => getRating(requireAuth(session).user.id, params.slug),
    {
      params: AnimeParams,
      detail: { summary: 'Get current user rating', tags: ['ratings'] },
    },
  )
  .put(
    '/anime/:slug/rating',
    ({ params, body, session }) => saveRating(requireAuth(session).user.id, params.slug, body),
    {
      params: AnimeParams,
      body: RatingUpsertBody,
      detail: { summary: 'Create or update rating', tags: ['ratings'] },
    },
  )
  .delete(
    '/anime/:slug/rating',
    ({ params, session }) => removeRating(requireAuth(session).user.id, params.slug),
    {
      params: AnimeParams,
      detail: { summary: 'Delete rating', tags: ['ratings'] },
    },
  )
  .get(
    '/anime/:slug/comments',
    ({ params, query, session }) => listComments(params.slug, query, session?.user.id ?? null, false),
    {
      params: AnimeParams,
      query: CommentQuery,
      detail: { summary: 'List anime comments', tags: ['comments'] },
    },
  )
  .post(
    '/anime/:slug/comments',
    async ({ params, body, session, set }) => {
      const result = await createComment(requireVerifiedEmail(session).user.id, params.slug, body);
      set.status = 201;
      return result;
    },
    {
      params: AnimeParams,
      body: CommentCreateBody,
      detail: { summary: 'Create anime comment', tags: ['comments'] },
    },
  )
  .get(
    '/anime/:slug/reviews',
    ({ params, query, session }) => listComments(params.slug, query, session?.user.id ?? null, true),
    {
      params: AnimeParams,
      query: CommentQuery,
      detail: { summary: 'List anime reviews', tags: ['reviews'] },
    },
  )
  .post(
    '/anime/:slug/reviews',
    async ({ params, body, session, set }) => {
      const result = await createReview(requireVerifiedEmail(session).user.id, params.slug, body);
      set.status = 201;
      return result;
    },
    {
      params: AnimeParams,
      body: ReviewCreateBody,
      detail: { summary: 'Create anime review', tags: ['reviews'] },
    },
  )
  .patch(
    '/comments/:commentId',
    ({ params, body, session }) => updateOwnedComment(requireAuth(session), params.commentId, body),
    {
      params: CommentParams,
      body: CommentUpdateBody,
      detail: { summary: 'Update own comment or review', tags: ['comments'] },
    },
  )
  .delete(
    '/comments/:commentId',
    ({ params, session }) => removeOwnedComment(requireAuth(session), params.commentId),
    {
      params: CommentParams,
      detail: { summary: 'Delete own comment or review', tags: ['comments'] },
    },
  );
