import { and, asc, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { NotFoundError, buildCursorPage, decodeCursor, encodeCursor } from '@playanime/shared';
import {
  AdminRepository,
  db,
  notifications,
  supportMessages,
  supportTickets,
  users,
  type Database,
} from '@playanime/database';
import {
  SupportMessageDirection,
  SupportTicketStatus,
  type SupportTicketCategory,
  type SupportTicketDto,
  type SupportTicketPage,
  type SupportTicketStatus as SupportTicketStatusValue,
  type SupportTicketThreadDto,
} from '@playanime/contracts';

/**
 * Support tickets — a logged-in user's own help requests, replied to by
 * staff from the admin panel. See `packages/contracts/src/support/index.ts`
 * for the full design rationale and why this is separate from `contact`.
 *
 * No repository class, matching `contact`/`blog`/`announcements`/`pages`'s
 * own modules: a small set of tables with no cross-module read pattern
 * anything else needs.
 */

const adminRepository = new AdminRepository(db());

interface Cursor {
  readonly v: string;
  readonly id: string;
}

const summaryColumns = {
  id: supportTickets.id,
  category: supportTickets.category,
  subject: supportTickets.subject,
  status: supportTickets.status,
  createdAt: supportTickets.createdAt,
  submitterUsername: users.username,
};

interface SummaryRow {
  id: string;
  category: SupportTicketCategory;
  subject: string;
  status: SupportTicketStatusValue;
  createdAt: Date;
  submitterUsername: string | null;
  lastMessage: string;
}

async function lastMessageFor(ticketId: string, database: Database): Promise<string> {
  const [row] = await database
    .select({ body: supportMessages.body })
    .from(supportMessages)
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(desc(supportMessages.createdAt))
    .limit(1);
  return row?.body ?? '';
}

function toSummaryDto(row: SummaryRow): SupportTicketDto {
  return {
    id: row.id,
    category: row.category,
    subject: row.subject,
    status: row.status,
    submitterUsername: row.submitterUsername ?? '',
    lastMessage: row.lastMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Creates a new ticket from the submitter's own report — its first (user) thread entry. */
export async function submitSupportTicket(
  submitterUserId: string,
  input: { category: SupportTicketCategory; subject: string; message: string },
  database: Database = db(),
): Promise<{ id: string }> {
  return database.transaction(async (tx) => {
    const [created] = await tx
      .insert(supportTickets)
      .values({
        submitterUserId,
        category: input.category,
        subject: input.subject,
        status: SupportTicketStatus.OPEN,
      })
      .returning({ id: supportTickets.id });

    if (created === undefined) throw new Error('Support ticket insert returned no row.');

    await tx.insert(supportMessages).values({
      ticketId: created.id,
      direction: SupportMessageDirection.USER,
      body: input.message,
    });

    return { id: created.id };
  });
}

/** The submitter's own tickets, newest first. */
export async function listMySupportTickets(
  submitterUserId: string,
  limit: number,
  cursor: string | undefined,
  database: Database = db(),
): Promise<SupportTicketPage> {
  const decoded = cursor === undefined ? null : (decodeCursor(cursor) as Cursor | null);
  const keyset: SQL | undefined =
    decoded === null
      ? undefined
      : or(
          lt(supportTickets.createdAt, new Date(decoded.v)),
          and(eq(supportTickets.createdAt, new Date(decoded.v)), lt(supportTickets.id, decoded.id)),
        );

  const rows = await database
    .select(summaryColumns)
    .from(supportTickets)
    .leftJoin(users, eq(users.id, supportTickets.submitterUserId))
    .where(and(eq(supportTickets.submitterUserId, submitterUserId), keyset))
    .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
    .limit(limit + 1);

  const withLastMessage = await Promise.all(
    rows.map(async (row) => ({ ...row, lastMessage: await lastMessageFor(row.id, database) })),
  );

  const page = buildCursorPage(withLastMessage, limit, (row) =>
    encodeCursor({ v: row.createdAt.toISOString(), id: row.id }),
  );

  return { items: page.items.map(toSummaryDto), nextCursor: page.nextCursor, hasMore: page.hasMore };
}

/** Staff queue — every ticket, optionally filtered by status, newest first. */
export async function listSupportTickets(
  status: SupportTicketStatusValue | undefined,
  limit: number,
  cursor: string | undefined,
  database: Database = db(),
): Promise<SupportTicketPage> {
  const decoded = cursor === undefined ? null : (decodeCursor(cursor) as Cursor | null);
  const keyset: SQL | undefined =
    decoded === null
      ? undefined
      : or(
          lt(supportTickets.createdAt, new Date(decoded.v)),
          and(eq(supportTickets.createdAt, new Date(decoded.v)), lt(supportTickets.id, decoded.id)),
        );

  const rows = await database
    .select(summaryColumns)
    .from(supportTickets)
    .leftJoin(users, eq(users.id, supportTickets.submitterUserId))
    .where(and(status === undefined ? undefined : eq(supportTickets.status, status), keyset))
    .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
    .limit(limit + 1);

  const withLastMessage = await Promise.all(
    rows.map(async (row) => ({ ...row, lastMessage: await lastMessageFor(row.id, database) })),
  );

  const page = buildCursorPage(withLastMessage, limit, (row) =>
    encodeCursor({ v: row.createdAt.toISOString(), id: row.id }),
  );

  return { items: page.items.map(toSummaryDto), nextCursor: page.nextCursor, hasMore: page.hasMore };
}

async function loadThread(ticketId: string, database: Database): Promise<SupportTicketThreadDto> {
  const [ticket] = await database
    .select({
      id: supportTickets.id,
      category: supportTickets.category,
      subject: supportTickets.subject,
      status: supportTickets.status,
      submitterUserId: supportTickets.submitterUserId,
      submitterUsername: users.username,
      createdAt: supportTickets.createdAt,
    })
    .from(supportTickets)
    .leftJoin(users, eq(users.id, supportTickets.submitterUserId))
    .where(eq(supportTickets.id, ticketId))
    .limit(1);

  if (ticket === undefined) {
    throw new NotFoundError('Nie znaleziono tego zgłoszenia.');
  }

  const messages = await database
    .select({
      id: supportMessages.id,
      direction: supportMessages.direction,
      body: supportMessages.body,
      sentByUsername: users.username,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .leftJoin(users, eq(users.id, supportMessages.sentByUserId))
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(asc(supportMessages.createdAt));

  return {
    id: ticket.id,
    category: ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    submitterUsername: ticket.submitterUsername ?? '',
    createdAt: ticket.createdAt.toISOString(),
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      body: message.body,
      sentByUsername: message.sentByUsername,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

/** The submitter's own ticket thread — 404s (not 403s) for someone else's ticket, so an id doesn't leak whether it exists. */
export async function getMySupportTicketThread(
  submitterUserId: string,
  ticketId: string,
  database: Database = db(),
): Promise<SupportTicketThreadDto> {
  const [owned] = await database
    .select({ submitterUserId: supportTickets.submitterUserId })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);

  if (owned?.submitterUserId !== submitterUserId) {
    throw new NotFoundError('Nie znaleziono tego zgłoszenia.');
  }

  return loadThread(ticketId, database);
}

/** Staff — any ticket's thread. */
export async function getSupportTicketThread(
  ticketId: string,
  database: Database = db(),
): Promise<SupportTicketThreadDto> {
  return loadThread(ticketId, database);
}

export interface SupportReplyContext {
  readonly actorUserId: string;
}

/** Staff reply — records the message, flips status to replied, and notifies the submitter in-app. */
export async function replyToSupportTicket(
  ticketId: string,
  message: string,
  context: SupportReplyContext,
  database: Database = db(),
): Promise<{ id: string; status: SupportTicketStatusValue }> {
  const [ticket] = await database
    .select({ id: supportTickets.id, subject: supportTickets.subject, submitterUserId: supportTickets.submitterUserId })
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);

  if (ticket === undefined) {
    throw new NotFoundError('Nie znaleziono tego zgłoszenia.');
  }

  await database.transaction(async (tx) => {
    await tx.insert(supportMessages).values({
      ticketId,
      direction: SupportMessageDirection.STAFF,
      body: message,
      sentByUserId: context.actorUserId,
    });

    await tx.update(supportTickets).set({ status: SupportTicketStatus.REPLIED }).where(eq(supportTickets.id, ticketId));

    await tx.insert(notifications).values({
      userId: ticket.submitterUserId,
      actorUserId: context.actorUserId,
      kind: 'system',
      title: 'Odpowiedź na Twoje zgłoszenie',
      body: `Otrzymałeś odpowiedź na zgłoszenie „${ticket.subject}”.`,
      href: `/support/${ticketId}`,
    });
  });

  await adminRepository.audit({
    action: 'reply_support_ticket',
    actorUserId: context.actorUserId,
    targetType: 'support_ticket',
    targetId: ticketId,
    reason: null,
  });

  return { id: ticketId, status: SupportTicketStatus.REPLIED };
}

/** Staff — closes a ticket with no further reply. */
export async function closeSupportTicket(
  ticketId: string,
  context: SupportReplyContext,
  database: Database = db(),
): Promise<{ id: string; status: SupportTicketStatusValue }> {
  const [updated] = await database
    .update(supportTickets)
    .set({ status: SupportTicketStatus.CLOSED })
    .where(eq(supportTickets.id, ticketId))
    .returning({ id: supportTickets.id });

  if (updated === undefined) {
    throw new NotFoundError('Nie znaleziono tego zgłoszenia.');
  }

  await adminRepository.audit({
    action: 'close_support_ticket',
    actorUserId: context.actorUserId,
    targetType: 'support_ticket',
    targetId: ticketId,
    reason: null,
  });

  return { id: ticketId, status: SupportTicketStatus.CLOSED };
}
