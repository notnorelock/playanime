import { Elysia, t } from 'elysia';
import {
  literalUnion,
  SUPPORT_TICKET_STATUSES,
  SupportTicketCreateBody,
  SupportTicketReplyBody,
} from '@playanime/contracts';
import { requireAuth, requireModerator } from '@playanime/auth';
import { clampPageSize } from '@playanime/shared';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import {
  closeSupportTicket,
  getMySupportTicketThread,
  getSupportTicketThread,
  listMySupportTickets,
  listSupportTickets,
  replyToMySupportTicket,
  replyToSupportTicket,
  submitSupportTicket,
} from './support.service.js';

const TicketParams = t.Object({ id: t.String({ format: 'uuid' }) });
const ListQuery = t.Object({
  cursor: t.Optional(t.String({ maxLength: 512 })),
  limit: t.Optional(t.Numeric()),
});

/**
 * Support tickets — a logged-in user's own help requests, replied to by
 * staff from the admin panel. See `packages/contracts/src/support/index.ts`
 * for the full design rationale.
 */
export const supportController = new Elysia({ prefix: '/support' })
  .use(sessionContext)

  /* ---------------------------------------------------------------- */
  /* The submitter's own tickets                                        */
  /* ---------------------------------------------------------------- */

  .group('', (app) =>
    app.use(rateLimit('submitSupportTicket')).post(
      '/tickets',
      ({ body, session, set }) => {
        const auth = requireAuth(session);
        set.status = 201;
        return submitSupportTicket(auth.user.id, body);
      },
      {
        body: SupportTicketCreateBody,
        detail: {
          summary: 'Submit a new support ticket',
          description: "Requires login — the ticket is filed under the caller's own account, in one of the fixed categories.",
          tags: ['support'],
        },
      },
    ),
  )
  .get(
    '/tickets/mine',
    ({ query, session }) => {
      const auth = requireAuth(session);
      return listMySupportTickets(auth.user.id, clampPageSize(query.limit), query.cursor);
    },
    {
      query: ListQuery,
      detail: { summary: "The caller's own tickets, newest first", tags: ['support'] },
    },
  )
  .get(
    '/tickets/mine/:id',
    ({ params, session }) => {
      const auth = requireAuth(session);
      return getMySupportTicketThread(auth.user.id, params.id);
    },
    {
      params: TicketParams,
      detail: {
        summary: "One of the caller's own tickets, with its full thread",
        description: "404s for another user's ticket, same as a nonexistent one.",
        tags: ['support'],
      },
    },
  )
  .post(
    '/tickets/mine/:id/reply',
    ({ params, body, session }) => {
      const auth = requireAuth(session);
      return replyToMySupportTicket(auth.user.id, params.id, body.message);
    },
    {
      params: TicketParams,
      body: SupportTicketReplyBody,
      detail: {
        summary: "Reply to one of the caller's own tickets",
        description: 'Reopens the ticket (back to open) — a genuine two-way thread, not only a staff broadcast. Rejected once the ticket is closed.',
        tags: ['support'],
      },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Staff queue — moderators and administrators                        */
  /* ---------------------------------------------------------------- */

  .get(
    '/tickets',
    ({ query, session }) => {
      requireModerator(session);
      return listSupportTickets(query.status, clampPageSize(query.limit), query.cursor);
    },
    {
      query: t.Composite([ListQuery, t.Object({ status: t.Optional(literalUnion(SUPPORT_TICKET_STATUSES)) })]),
      detail: {
        summary: 'The staff ticket queue',
        description: 'Every ticket, newest first, optionally filtered by status.',
        tags: ['support'],
      },
    },
  )
  .get(
    '/tickets/:id',
    ({ params, session }) => {
      requireModerator(session);
      return getSupportTicketThread(params.id);
    },
    {
      params: TicketParams,
      detail: { summary: 'One ticket, with its full ordered thread', tags: ['support'] },
    },
  )
  .post(
    '/tickets/:id/reply',
    ({ params, body, session }) => {
      const moderator = requireModerator(session);
      return replyToSupportTicket(params.id, body.message, { actorUserId: moderator.user.id });
    },
    {
      params: TicketParams,
      body: SupportTicketReplyBody,
      detail: {
        summary: 'Reply to a support ticket',
        description: 'Records the reply, marks the ticket replied, and notifies the submitter in-app.',
        tags: ['support'],
      },
    },
  )
  .post(
    '/tickets/:id/close',
    ({ params, session }) => {
      const moderator = requireModerator(session);
      return closeSupportTicket(params.id, { actorUserId: moderator.user.id });
    },
    {
      params: TicketParams,
      detail: { summary: 'Close a ticket with no further reply', tags: ['support'] },
    },
  );
