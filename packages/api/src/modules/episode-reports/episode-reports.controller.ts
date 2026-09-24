import { Elysia, t } from 'elysia';
import { EpisodeReportCreateBody, EpisodeReportResolveBody, EPISODE_REPORT_STATUSES, hasAtLeastTranslatorRole, literalUnion, TranslatorRole } from '@playanime/contracts';
import { requireAuth, requireModerator } from '@playanime/auth';
import { AuthorizationError, ErrorCode } from '@playanime/shared';
import { db, TranslatorRepository } from '@playanime/database';
import type { RequestSession } from '../../plugins/session.js';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import {
  listEpisodeReports,
  listEpisodeReportsForGroup,
  resolveEpisodeReport,
  submitEpisodeReport,
} from './episode-reports.service.js';

const translatorRepository = new TranslatorRepository(db());

/** A group leader acting for their own group — checked here AND again inside the service before any write, matching this codebase's `add-privileged-action` discipline. */
async function requireGroupLeader(session: RequestSession | null, groupId: string) {
  const auth = requireAuth(session);
  const membership = await translatorRepository.membership(groupId, auth.user.id);

  if (membership === null || !hasAtLeastTranslatorRole(membership.role, TranslatorRole.LEADER)) {
    throw new AuthorizationError('Nie jesteś liderem tej grupy.', { code: ErrorCode.FORBIDDEN });
  }

  return auth;
}

/**
 * "Report episode" — see `packages/contracts/src/episode-reports/index.ts`
 * for the full design rationale.
 *
 * Two people can resolve a report: platform staff (any report), or the
 * leader of a group credited on the reported episode (only their own
 * group's reports) — a broken episode is usually the credited group's own
 * release, and they're best placed to confirm/fix it themselves rather
 * than waiting on staff triage.
 */
export const episodeReportsController = new Elysia({ prefix: '/episode-reports' })
  .use(sessionContext)
  .group('', (app) =>
    app.use(rateLimit('submitReport')).post(
      '/',
      ({ body, session, set }) => {
        const auth = requireAuth(session);
        set.status = 201;
        return submitEpisodeReport(auth.user.id, body);
      },
      {
        body: EpisodeReportCreateBody,
        detail: {
          summary: 'Report a broken/wrong episode',
          description: 'Requires login. Any user may report the same episode more than once.',
          tags: ['episode-reports'],
        },
      },
    ),
  )
  .get(
    '/',
    ({ query, session }) => {
      requireModerator(session);
      return listEpisodeReports(query.status, query.limit ?? 50);
    },
    {
      query: t.Object({
        status: t.Optional(literalUnion(EPISODE_REPORT_STATUSES)),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
      }),
      detail: {
        summary: 'The staff episode-report queue',
        description: 'Newest first, optionally filtered by status.',
        tags: ['episode-reports'],
      },
    },
  )
  .get(
    '/groups/:groupId',
    async ({ params, query, session }) => {
      await requireGroupLeader(session, params.groupId);
      return listEpisodeReportsForGroup(params.groupId, query.limit ?? 50);
    },
    {
      params: t.Object({ groupId: t.String({ format: 'uuid' }) }),
      query: t.Object({ limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })) }),
      detail: {
        summary: "A group leader's own queue",
        description: 'Only reports for episodes the group is credited on. Group-leader-only.',
        tags: ['episode-reports'],
      },
    },
  )
  .post(
    '/:id/resolve',
    async ({ params, body, session, query }) => {
      if (query.groupId !== undefined) {
        const auth = await requireGroupLeader(session, query.groupId);
        return resolveEpisodeReport(params.id, body, { actorUserId: auth.user.id, asGroupId: query.groupId });
      }

      const moderator = requireModerator(session);
      return resolveEpisodeReport(params.id, body, { actorUserId: moderator.user.id });
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      query: t.Object({ groupId: t.Optional(t.String({ format: 'uuid' })) }),
      body: EpisodeReportResolveBody,
      detail: {
        summary: 'Resolve a report',
        description:
          'Records the status and optional reply, then emails the reporter. Staff resolves any report; passing groupId resolves as that group\'s leader instead — only valid for a report on an episode the group is credited on.',
        tags: ['episode-reports'],
      },
    },
  );
