import { asc, desc, eq, sql } from 'drizzle-orm';
import { NotFoundError } from '@playanime/shared';
import {
  ContactMessageDirection,
  ContactMessageStatus,
  type ContactMessageDto,
  type ContactMessageStatus as ContactMessageStatusValue,
  type ContactMessageThreadDto,
} from '@playanime/contracts';
import { contactMessageReplies, contactMessages, db, users, type Database } from '@playanime/database';
import { fetchReceivedEmail, renderContactReplyEmail, sendEmail } from '@playanime/email';
import { env } from '@playanime/config';
import { logger } from '../../plugins/error-handler.js';

/**
 * The staff contact inbox.
 *
 * There is nowhere else to read a submission once `POST /contact` fires —
 * `CONTACT_EMAIL` isn't an inbox staff can log into — so this is the only
 * place a message is ever actually seen or answered from. A conversation
 * (`contactMessages`) holds an ordered thread of messages
 * (`contactMessageReplies`) in either direction; the original form
 * submission IS the thread's first inbound entry, not a separate field.
 */

export async function listContactMessages(
  status: ContactMessageStatusValue | undefined,
  limit: number,
  database: Database = db(),
): Promise<ContactMessageDto[]> {
  // Built as a real Drizzle query-builder subquery, not a raw `sql` template
  // referencing bare columns — interpolating `${table.column}` into a raw
  // template renders an UNQUALIFIED column name, which is ambiguous the
  // moment the subquery's own table has a same-named column (both
  // `contactMessageReplies` and `contactMessages` are fine here, but this
  // exact mistake elsewhere in this codebase, `moderation.service.ts`'s
  // `openReportCount`, silently resolves to the wrong table's `id` and
  // always undercounts — see that file for the matching fix). Wrapping a
  // proper subquery in `sql\`(${sub})\`` makes Drizzle qualify every column
  // with its actual table name.
  const lastMessageSubquery = database
    .select({ body: contactMessageReplies.body })
    .from(contactMessageReplies)
    .where(eq(contactMessageReplies.contactMessageId, contactMessages.id))
    .orderBy(desc(contactMessageReplies.createdAt))
    .limit(1);

  const rows = await database
    .select({
      id: contactMessages.id,
      name: contactMessages.name,
      email: contactMessages.email,
      subject: contactMessages.subject,
      status: contactMessages.status,
      createdAt: contactMessages.createdAt,
      // Every conversation has at least one reply (its own originating
      // message), but the subquery's type can't express that — cast
      // through `string | null` rather than a bare `string` so the
      // fallback below isn't flagged as dead code.
      lastMessage: sql<string | null>`(${lastMessageSubquery})`.as('last_message'),
    })
    .from(contactMessages)
    .where(status === undefined ? undefined : eq(contactMessages.status, status))
    .orderBy(desc(contactMessages.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    status: row.status,
    lastMessage: row.lastMessage ?? '',
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getContactMessageThread(
  messageId: string,
  database: Database = db(),
): Promise<ContactMessageThreadDto> {
  const [message] = await database.select().from(contactMessages).where(eq(contactMessages.id, messageId)).limit(1);

  if (message === undefined) {
    throw new NotFoundError('Nie znaleziono tej wiadomości.');
  }

  const replies = await database
    .select({
      id: contactMessageReplies.id,
      direction: contactMessageReplies.direction,
      body: contactMessageReplies.body,
      sentByUsername: users.username,
      fromAddress: contactMessageReplies.fromAddress,
      createdAt: contactMessageReplies.createdAt,
    })
    .from(contactMessageReplies)
    .leftJoin(users, eq(users.id, contactMessageReplies.sentByUserId))
    .where(eq(contactMessageReplies.contactMessageId, messageId))
    .orderBy(asc(contactMessageReplies.createdAt));

  return {
    id: message.id,
    name: message.name,
    email: message.email,
    subject: message.subject,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    replies: replies.map((reply) => ({
      id: reply.id,
      direction: reply.direction,
      body: reply.body,
      sentByUsername: reply.sentByUsername,
      fromAddress: reply.fromAddress,
      createdAt: reply.createdAt.toISOString(),
    })),
  };
}

/** Creates a new conversation from a form submission — its first (inbound) thread entry. */
export async function submitContactMessage(
  input: { name: string; email: string; subject: string; message: string },
  database: Database = db(),
): Promise<{ id: string }> {
  return database.transaction(async (tx) => {
    const [created] = await tx
      .insert(contactMessages)
      .values({ name: input.name, email: input.email, subject: input.subject, status: ContactMessageStatus.NEW })
      .returning({ id: contactMessages.id });

    if (created === undefined) throw new Error('Contact message insert returned no row.');

    await tx.insert(contactMessageReplies).values({
      contactMessageId: created.id,
      direction: ContactMessageDirection.INBOUND,
      body: input.message,
      fromAddress: input.email,
    });

    return { id: created.id };
  });
}

export interface ReplyContext {
  readonly actorUserId: string;
}

/**
 * Records a staff reply and sends it, in that order: the reply is recorded
 * first so a transient email failure never loses track of what a moderator
 * already wrote, then the send is attempted and its failure is surfaced to
 * the caller (not swallowed) — unlike the takedown-resolution email, this
 * send IS the point of the action, so the moderator needs to know if it
 * didn't go out rather than believing a silent no-op succeeded.
 */
export async function replyToContactMessage(
  messageId: string,
  replyText: string,
  context: ReplyContext,
  database: Database = db(),
): Promise<{ id: string; status: ContactMessageStatusValue }> {
  const [message] = await database.select().from(contactMessages).where(eq(contactMessages.id, messageId)).limit(1);

  if (message === undefined) {
    throw new NotFoundError('Nie znaleziono tej wiadomości.');
  }

  const [latest] = await database
    .select({ body: contactMessageReplies.body })
    .from(contactMessageReplies)
    .where(eq(contactMessageReplies.contactMessageId, messageId))
    .orderBy(desc(contactMessageReplies.createdAt))
    .limit(1);

  const { subject, html, text } = renderContactReplyEmail({
    subject: message.subject,
    originalMessage: latest?.body ?? '',
    replyText,
  });

  // `from: CONTACT_EMAIL` where set, so the visitor sees the reply as coming
  // from the address they originally wrote to, not the generic
  // RESEND_FROM_ADDRESS `sendEmail` otherwise defaults to. `sendEmail` itself
  // still no-ops gracefully (logged, not thrown) when RESEND isn't
  // configured at all — only a genuine failed send throws here.
  const contactEmail = env().CONTACT_EMAIL;
  let resendMessageId: string | undefined;

  try {
    resendMessageId = await sendEmail(
      { to: message.email, subject, html, text, ...(contactEmail === undefined ? {} : { from: contactEmail }) },
      logger,
    );
  } catch (cause: unknown) {
    logger.error('Failed to send contact reply email', cause, { module: 'contact' });
    throw cause;
  }

  await database.transaction(async (tx) => {
    await tx.insert(contactMessageReplies).values({
      contactMessageId: messageId,
      direction: ContactMessageDirection.OUTBOUND,
      body: replyText,
      sentByUserId: context.actorUserId,
      ...(resendMessageId === undefined ? {} : { resendMessageId }),
    });

    await tx.update(contactMessages).set({ status: ContactMessageStatus.REPLIED }).where(eq(contactMessages.id, messageId));
  });

  return { id: messageId, status: ContactMessageStatus.REPLIED };
}

/**
 * Records an inbound email — either a reply to an existing thread or a
 * fresh conversation. Idempotent: a redelivered webhook for the same
 * `resendEmailId` is a no-op, not a duplicate row (see the partial unique
 * index).
 *
 * Thread matching is by SENDER ADDRESS against the most recent
 * conversation from that address, not `In-Reply-To`: Resend's public docs
 * don't specify the exact relationship between the `id` a send responds
 * with and the `Message-Id` header the recipient's client actually sees,
 * so building a match on a guessed format would be unverifiable and
 * silently wrong. Every staff reply already goes `to:` the visitor's own
 * address `from: CONTACT_EMAIL` — a genuine reply-to-that arrives `from:`
 * the same visitor address, which is what a lightweight support inbox can
 * reliably match on without RFC-level threading.
 */
export async function receiveContactEmail(
  resendEmailId: string,
  database: Database = db(),
): Promise<void> {
  const email = await fetchReceivedEmail(resendEmailId);

  await database.transaction(async (tx) => {
    const [matched] = await tx
      .select({ id: contactMessages.id })
      .from(contactMessages)
      .where(eq(contactMessages.email, email.from))
      .orderBy(desc(contactMessages.createdAt))
      .limit(1);

    let contactMessageId: string | undefined = matched?.id;

    if (contactMessageId === undefined) {
      const [created] = await tx
        .insert(contactMessages)
        .values({
          name: email.from,
          email: email.from,
          subject: email.subject,
          status: ContactMessageStatus.NEW,
        })
        .returning({ id: contactMessages.id });

      if (created === undefined) throw new Error('Contact message insert returned no row.');
      contactMessageId = created.id;
    } else {
      await tx.update(contactMessages).set({ status: ContactMessageStatus.NEW }).where(eq(contactMessages.id, contactMessageId));
    }

    await tx
      .insert(contactMessageReplies)
      .values({
        contactMessageId,
        direction: ContactMessageDirection.INBOUND,
        body: email.text ?? email.html,
        resendEmailId: email.id,
        fromAddress: email.from,
      })
      .onConflictDoNothing({ target: contactMessageReplies.resendEmailId });
  });
}
