import { Elysia, t } from 'elysia';
import {
  AdminAnalyticsQuery,
  AdminCommentQuery,
  AdminEntryUpdateBody,
  AdminRoleUpdateBody,
  AdminSanctionBody,
  AdminSeriesQuery,
  AdminSeriesUpdateBody,
  AdminTranslatorActionBody,
  AdminUserQuery,
} from '@playanime/contracts';
import { requireAdmin, requireModerator } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import {
  deleteAnime,
  getAnalytics,
  getOverview,
  liftUserSanctions,
  listAnime,
  listComments,
  listUserSanctions,
  listUsers,
  moderateComment,
  sanctionUser,
  setAnimeVisibility,
  setGroupSuspended,
  setGroupVerified,
  updateAnime,
  updateSeries,
  updateUserRole,
} from './admin.service.js';

/**
 * Administration console.
 *
 * Mounted under `/admin`, alongside the source moderation routes. Two tiers:
 * moderators handle content (comments, catalogue metadata, group suspension),
 * while only administrators touch accounts — roles, sanctions and the platform
 * overview. That split is enforced per route, not by a blanket prefix guard, so
 * each endpoint states the rank it needs.
 */

const UserIdParams = t.Object({ userId: t.String({ format: 'uuid' }) });
const AnimeIdParams = t.Object({ animeId: t.String({ format: 'uuid' }) });
const CommentIdParams = t.Object({ commentId: t.String({ format: 'uuid' }) });
const SlugParams = t.Object({ slug: t.String({ maxLength: 96 }) });

/** Every destructive action records why. An audit row without a reason is noise. */
const ReasonBody = t.Object({ reason: t.String({ minLength: 1, maxLength: 1000 }) });

export const adminController = new Elysia({ prefix: '/admin' })
  .use(sessionContext)

  /* ---------------------------------------------------------------- */
  /* Overview and analytics                                            */
  /* ---------------------------------------------------------------- */

  .get(
    '/overview',
    ({ session }) => {
      requireModerator(session);
      return getOverview();
    },
    {
      detail: {
        summary: 'Platform overview',
        description:
          'Exact counts computed from the tables. Nothing here is estimated or placeholder.',
        tags: ['admin'],
      },
    },
  )
  .get(
    '/analytics',
    ({ query, session }) => {
      requireModerator(session);
      return getAnalytics(query);
    },
    {
      query: AdminAnalyticsQuery,
      detail: {
        summary: 'Daily activity series',
        description: 'Days with no activity are returned as zero rather than omitted.',
        tags: ['admin'],
      },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Users — administrators only                                       */
  /* ---------------------------------------------------------------- */

  .get(
    '/users',
    ({ query, session }) => {
      requireAdmin(session);
      return listUsers(query);
    },
    {
      query: AdminUserQuery,
      detail: {
        summary: 'List users',
        description: 'Includes email addresses, so this is administrator-only.',
        tags: ['admin'],
      },
    },
  )
  .patch(
    '/users/:userId/role',
    ({ params, body, session }) => {
      const auth = requireAdmin(session);
      return updateUserRole({ id: auth.user.id, role: auth.user.role }, params.userId, body);
    },
    {
      params: UserIdParams,
      body: AdminRoleUpdateBody,
      detail: {
        summary: 'Change a user role',
        description:
          'Refuses to act on a peer or superior, and refuses to grant a role at or above the actor\'s own.',
        tags: ['admin'],
      },
    },
  )
  .post(
    '/users/:userId/sanctions',
    async ({ params, body, session, set }) => {
      const auth = requireModerator(session);
      const result = await sanctionUser(
        { id: auth.user.id, role: auth.user.role },
        params.userId,
        body,
      );
      set.status = 201;
      return result;
    },
    {
      params: UserIdParams,
      body: AdminSanctionBody,
      detail: {
        summary: 'Sanction a user',
        description: 'A suspension must carry a duration; a ban may be permanent.',
        tags: ['admin'],
      },
    },
  )
  .get(
    '/users/:userId/sanctions',
    ({ params, session }) => {
      requireModerator(session);
      return listUserSanctions(params.userId);
    },
    {
      params: UserIdParams,
      detail: { summary: 'Sanction history for a user', tags: ['admin'] },
    },
  )
  .delete(
    '/users/:userId/sanctions',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return liftUserSanctions({ id: auth.user.id, role: auth.user.role }, params.userId, body.reason);
    },
    {
      params: UserIdParams,
      body: ReasonBody,
      detail: { summary: 'Lift every active sanction on a user', tags: ['admin'] },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Catalogue                                                         */
  /* ---------------------------------------------------------------- */

  .get(
    '/anime',
    ({ query, session }) => {
      requireModerator(session);
      return listAnime(query);
    },
    {
      query: AdminSeriesQuery,
      detail: {
        summary: 'List catalogue titles',
        description: 'Can include soft-deleted rows, which the public API never returns.',
        tags: ['admin'],
      },
    },
  )
  .patch(
    '/anime/:animeId',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return updateAnime({ id: auth.user.id, role: auth.user.role }, params.animeId, body);
    },
    {
      params: AnimeIdParams,
      body: AdminEntryUpdateBody,
      detail: { summary: 'Edit catalogue metadata (the series\' main entry)', tags: ['admin'] },
    },
  )
  .patch(
    '/anime/:animeId/series',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return updateSeries({ id: auth.user.id, role: auth.user.role }, params.animeId, body);
    },
    {
      params: AnimeIdParams,
      body: AdminSeriesUpdateBody,
      detail: { summary: 'Edit series-level metadata (isAdult, synopsis)', tags: ['admin'] },
    },
  )
  .post(
    '/anime/:animeId/hide',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return setAnimeVisibility(
        { id: auth.user.id, role: auth.user.role },
        params.animeId,
        true,
        body.reason,
      );
    },
    {
      params: AnimeIdParams,
      body: ReasonBody,
      detail: {
        summary: 'Hide a title',
        description: 'Soft delete: sources and library entries keep their referent.',
        tags: ['admin'],
      },
    },
  )
  .post(
    '/anime/:animeId/restore',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return setAnimeVisibility(
        { id: auth.user.id, role: auth.user.role },
        params.animeId,
        false,
        body.reason,
      );
    },
    {
      params: AnimeIdParams,
      body: ReasonBody,
      detail: { summary: 'Restore a hidden title', tags: ['admin'] },
    },
  )
  .delete(
    '/anime/:animeId',
    ({ params, body, session }) => {
      const auth = requireAdmin(session);
      return deleteAnime({ id: auth.user.id, role: auth.user.role }, params.animeId, body.reason);
    },
    {
      params: AnimeIdParams,
      body: ReasonBody,
      detail: {
        summary: 'Permanently delete a title',
        description:
          'Hard delete: the series, its entries, episodes, sources, and every rating/comment/library entry/watch-progress row pointing at it are gone, irreversibly. Administrator only — not the moderator tier hide/restore uses.',
        tags: ['admin'],
      },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Comment moderation                                                */
  /* ---------------------------------------------------------------- */

  .get(
    '/comments',
    ({ query, session }) => {
      requireModerator(session);
      return listComments(query);
    },
    {
      query: AdminCommentQuery,
      detail: {
        summary: 'Comment moderation queue',
        description: 'Defaults to comments with open reports, ordered newest first.',
        tags: ['admin'],
      },
    },
  )
  .post(
    '/comments/:commentId/remove',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return moderateComment(
        { id: auth.user.id, role: auth.user.role },
        params.commentId,
        true,
        body.reason,
      );
    },
    {
      params: CommentIdParams,
      body: ReasonBody,
      detail: {
        summary: 'Remove a comment',
        description: 'The row is retained for the audit trail; only its visibility changes.',
        tags: ['admin'],
      },
    },
  )
  .post(
    '/comments/:commentId/restore',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return moderateComment(
        { id: auth.user.id, role: auth.user.role },
        params.commentId,
        false,
        body.reason,
      );
    },
    {
      params: CommentIdParams,
      body: ReasonBody,
      detail: { summary: 'Restore a removed comment', tags: ['admin'] },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Translator groups                                                 */
  /* ---------------------------------------------------------------- */

  .post(
    '/translators/:slug/verify',
    ({ params, body, session }) => {
      const auth = requireAdmin(session);
      return setGroupVerified({ id: auth.user.id, role: auth.user.role }, params.slug, true, body.reason);
    },
    {
      params: SlugParams,
      body: AdminTranslatorActionBody,
      detail: {
        summary: 'Verify a translator group',
        description: 'Groups cannot grant themselves the badge; that is what it certifies.',
        tags: ['admin'],
      },
    },
  )
  .delete(
    '/translators/:slug/verify',
    ({ params, body, session }) => {
      const auth = requireAdmin(session);
      return setGroupVerified(
        { id: auth.user.id, role: auth.user.role },
        params.slug,
        false,
        body.reason,
      );
    },
    {
      params: SlugParams,
      body: AdminTranslatorActionBody,
      detail: { summary: 'Revoke group verification', tags: ['admin'] },
    },
  )
  .post(
    '/translators/:slug/suspend',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return setGroupSuspended(
        { id: auth.user.id, role: auth.user.role },
        params.slug,
        true,
        body.reason,
      );
    },
    {
      params: SlugParams,
      body: AdminTranslatorActionBody,
      detail: {
        summary: 'Suspend a translator group',
        description: 'The group stops rendering publicly; its rows and credits survive.',
        tags: ['admin'],
      },
    },
  )
  .delete(
    '/translators/:slug/suspend',
    ({ params, body, session }) => {
      const auth = requireModerator(session);
      return setGroupSuspended(
        { id: auth.user.id, role: auth.user.role },
        params.slug,
        false,
        body.reason,
      );
    },
    {
      params: SlugParams,
      body: AdminTranslatorActionBody,
      detail: { summary: 'Lift a group suspension', tags: ['admin'] },
    },
  );
