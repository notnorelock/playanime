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

const AnimeParams = t.Object({ animeId: t.String({ format: 'uuid' }) });
const CommentParams = t.Object({ commentId: t.String({ format: 'uuid' }) });

export const engagementController = new Elysia()
  .use(sessionContext)
  .get(
    '/anime/:animeId/rating',
    ({ params, session }) => getRating(requireAuth(session).user.id, params.animeId),
    {
      params: AnimeParams,
      detail: { summary: 'Get current user rating', tags: ['ratings'] },
    },
  )
  .put(
    '/anime/:animeId/rating',
    ({ params, body, session }) => saveRating(requireAuth(session).user.id, params.animeId, body),
    {
      params: AnimeParams,
      body: RatingUpsertBody,
      detail: { summary: 'Create or update rating', tags: ['ratings'] },
    },
  )
  .delete(
    '/anime/:animeId/rating',
    ({ params, session }) => removeRating(requireAuth(session).user.id, params.animeId),
    {
      params: AnimeParams,
      detail: { summary: 'Delete rating', tags: ['ratings'] },
    },
  )
  .get(
    '/anime/:animeId/comments',
    ({ params, query, session }) => listComments(params.animeId, query, session?.user.id ?? null, false),
    {
      params: AnimeParams,
      query: CommentQuery,
      detail: { summary: 'List anime comments', tags: ['comments'] },
    },
  )
  .post(
    '/anime/:animeId/comments',
    async ({ params, body, session, set }) => {
      const result = await createComment(requireVerifiedEmail(session).user.id, params.animeId, body);
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
    '/anime/:animeId/reviews',
    ({ params, query, session }) => listComments(params.animeId, query, session?.user.id ?? null, true),
    {
      params: AnimeParams,
      query: CommentQuery,
      detail: { summary: 'List anime reviews', tags: ['reviews'] },
    },
  )
  .post(
    '/anime/:animeId/reviews',
    async ({ params, body, session, set }) => {
      const result = await createReview(requireVerifiedEmail(session).user.id, params.animeId, body);
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
