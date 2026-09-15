import { Elysia, t } from 'elysia';
import { ModerationAction, ModerationDecisionRequest } from '@playanime/contracts';
import { requireModerator } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import { auditTrail, decideSource, listPendingSources } from './moderation.service.js';

/**
 * Moderation routes.
 *
 * Authorization is enforced here, server-side, on every route. The admin UI
 * hides these controls from ordinary users, but that is presentation — hiding a
 * button does not stop anyone from calling the endpoint, so `requireModerator`
 * is what actually decides.
 *
 * The routes are written out rather than generated from a table. A factory
 * would be shorter, but it obscures which paths exist, and an endpoint that
 * changes a moderation state should be greppable by its own URL.
 */

const SourceIdParams = t.Object({ id: t.String({ format: 'uuid' }) });

const decisionSchema = {
  params: SourceIdParams,
  body: ModerationDecisionRequest,
} as const;

export const moderationController = new Elysia({ prefix: '/admin' })
  .use(sessionContext)
  .get(
    '/sources/pending',
    async ({ session, query }) => {
      requireModerator(session);
      return listPendingSources(query.limit ?? 50);
    },
    {
      query: t.Object({ limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })) }),
      detail: {
        summary: 'Moderation queue',
        description:
          'Pending sources, oldest first, with the submitter identity, the rights attestation timestamp, and the count of open reports.',
        tags: ['moderation'],
      },
    },
  )
  .post(
    '/sources/:id/approve',
    async ({ params, body, session, clientIp }) => {
      const moderator = requireModerator(session);
      return decideSource(params.id, ModerationAction.APPROVE_SOURCE, body, {
        actorUserId: moderator.user.id,
        actorIpAddress: clientIp,
      });
    },
    {
      ...decisionSchema,
      detail: { summary: 'Approve a source, making it visible to viewers', tags: ['moderation'] },
    },
  )
  .post(
    '/sources/:id/reject',
    async ({ params, body, session, clientIp }) => {
      const moderator = requireModerator(session);
      return decideSource(params.id, ModerationAction.REJECT_SOURCE, body, {
        actorUserId: moderator.user.id,
        actorIpAddress: clientIp,
      });
    },
    {
      ...decisionSchema,
      detail: { summary: 'Reject a submission', tags: ['moderation'] },
    },
  )
  .post(
    '/sources/:id/disable',
    async ({ params, body, session, clientIp }) => {
      const moderator = requireModerator(session);
      return decideSource(params.id, ModerationAction.DISABLE_SOURCE, body, {
        actorUserId: moderator.user.id,
        actorIpAddress: clientIp,
      });
    },
    {
      ...decisionSchema,
      detail: { summary: 'Disable an approved source', tags: ['moderation'] },
    },
  )
  .post(
    '/sources/:id/block',
    async ({ params, body, session, clientIp }) => {
      const moderator = requireModerator(session);
      return decideSource(params.id, ModerationAction.BLOCK_SOURCE, body, {
        actorUserId: moderator.user.id,
        actorIpAddress: clientIp,
      });
    },
    {
      ...decisionSchema,
      detail: {
        summary: 'Block a resource and bar resubmission across the catalogue',
        tags: ['moderation'],
      },
    },
  )
  .post(
    '/sources/:id/copyright-claim',
    async ({ params, body, session, clientIp }) => {
      const moderator = requireModerator(session);
      return decideSource(params.id, ModerationAction.APPLY_COPYRIGHT_CLAIM, body, {
        actorUserId: moderator.user.id,
        actorIpAddress: clientIp,
      });
    },
    {
      ...decisionSchema,
      detail: {
        summary: 'Disable a source following a rights-holder complaint',
        description: 'Also adds the resource to the block list, barring resubmission.',
        tags: ['moderation'],
      },
    },
  )
  .post(
    '/sources/:id/mark-unavailable',
    async ({ params, body, session, clientIp }) => {
      const moderator = requireModerator(session);
      return decideSource(params.id, ModerationAction.MARK_UNAVAILABLE, body, {
        actorUserId: moderator.user.id,
        actorIpAddress: clientIp,
      });
    },
    {
      ...decisionSchema,
      detail: { summary: 'Mark a source as currently unavailable upstream', tags: ['moderation'] },
    },
  )
  .post(
    '/sources/:id/restore',
    async ({ params, body, session, clientIp }) => {
      const moderator = requireModerator(session);
      return decideSource(params.id, ModerationAction.RESTORE_SOURCE, body, {
        actorUserId: moderator.user.id,
        actorIpAddress: clientIp,
      });
    },
    {
      ...decisionSchema,
      detail: { summary: 'Restore a previously disabled source', tags: ['moderation'] },
    },
  )
  .get(
    '/audit/:targetType/:targetId',
    async ({ session, params }) => {
      requireModerator(session);
      return auditTrail(params.targetType, params.targetId);
    },
    {
      params: t.Object({
        targetType: t.String({ maxLength: 32 }),
        targetId: t.String({ format: 'uuid' }),
      }),
      detail: {
        summary: 'Audit trail for one object',
        description: 'Every recorded moderation decision, newest first.',
        tags: ['moderation'],
      },
    },
  );
