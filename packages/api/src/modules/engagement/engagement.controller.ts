import { Elysia, t } from 'elysia';
import {
  CommentCreateBody,
  CommentQuery,
  CommentUpdateBody,
  RatingUpsertBody,
  ReactionToggleBody,
  ReviewCreateBody,
} from '@playanime/contracts';
import { requireAuth, requireVerifiedEmail } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import {
  createComment,
  createEpisodeComment,
  createReview,
  listComments,
  listEpisodeComments,
  removeOwnedComment,
  toggleCommentLike,
  updateOwnedComment,
} from './comments.service.js';
import {
  getEpisodeRatingSummary,
  getRating,
  removeEpisodeRating,
  removeRating,
  saveEpisodeRating,
  saveRating,
  toggleEpisodeReaction,
} from './ratings.service.js';

const AnimeParams = t.Object({ slug: t.String({ format: 'uuid' }) });
const CommentParams = t.Object({ commentId: t.String({ format: 'uuid' }) });
const EpisodeParams = t.Object({ episodeId: t.String({ format: 'uuid' }) });

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
  )

  /* ---------------------------------------------------------------- */
  /* Comment likes                                                     */
  /* ---------------------------------------------------------------- */

  .post(
    '/comments/:commentId/like',
    ({ params, session }) => toggleCommentLike(requireAuth(session).user.id, params.commentId),
    {
      params: CommentParams,
      detail: {
        summary: 'Like or unlike a comment',
        description:
          'A toggle: the response carries the resulting count and state, so a repeated click cannot double-count.',
        tags: ['comments'],
      },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Episode comments                                                  */
  /* ---------------------------------------------------------------- */

  .get(
    '/episodes/:episodeId/comments',
    ({ params, query, session }) =>
      listEpisodeComments(params.episodeId, query, session?.user.id ?? null),
    {
      params: EpisodeParams,
      query: CommentQuery,
      detail: { summary: 'List episode comments', tags: ['comments'] },
    },
  )
  .post(
    '/episodes/:episodeId/comments',
    async ({ params, body, session, set }) => {
      const result = await createEpisodeComment(
        requireVerifiedEmail(session).user.id,
        params.episodeId,
        body,
      );
      set.status = 201;
      return result;
    },
    {
      params: EpisodeParams,
      body: CommentCreateBody,
      detail: { summary: 'Create an episode comment', tags: ['comments'] },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Episode ratings and reactions                                     */
  /* ---------------------------------------------------------------- */

  .get(
    '/episodes/:episodeId/rating',
    ({ params, session }) => getEpisodeRatingSummary(params.episodeId, session?.user.id ?? null),
    {
      params: EpisodeParams,
      detail: {
        summary: 'Episode rating summary',
        description:
          "Aggregate score, reaction tallies, and the viewer's own score and reactions in one response.",
        tags: ['ratings'],
      },
    },
  )
  .put(
    '/episodes/:episodeId/rating',
    ({ params, body, session }) =>
      saveEpisodeRating(requireAuth(session).user.id, params.episodeId, body),
    {
      params: EpisodeParams,
      body: RatingUpsertBody,
      detail: {
        summary: 'Rate an episode',
        description: 'Returns the refreshed summary, so the caller needs no follow-up read.',
        tags: ['ratings'],
      },
    },
  )
  .delete(
    '/episodes/:episodeId/rating',
    ({ params, session }) => removeEpisodeRating(requireAuth(session).user.id, params.episodeId),
    {
      params: EpisodeParams,
      detail: { summary: 'Remove your episode rating', tags: ['ratings'] },
    },
  )
  .post(
    '/episodes/:episodeId/reactions',
    ({ params, body, session }) =>
      toggleEpisodeReaction(requireAuth(session).user.id, params.episodeId, body.kind),
    {
      params: EpisodeParams,
      body: ReactionToggleBody,
      detail: {
        summary: 'Toggle an episode reaction',
        description: 'Tracked separately from the score, so reacting is not a rating.',
        tags: ['ratings'],
      },
    },
  );
