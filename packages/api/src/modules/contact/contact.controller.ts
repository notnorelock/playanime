import { Elysia, t } from 'elysia';
import {
  CONTACT_MESSAGE_STATUSES,
  ContactMessageRequest,
  ContactMessageResponse,
  ContactReplyBody,
  literalUnion,
} from '@playanime/contracts';
import { AuthenticationError, ServiceUnavailableError } from '@playanime/shared';
import { requireModerator } from '@playanime/auth';
import { env } from '@playanime/config';
import { renderContactMessageEmail, sendEmail, verifyResendWebhook } from '@playanime/email';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { logger } from '../../plugins/error-handler.js';
import {
  getContactMessageThread,
  listContactMessages,
  receiveContactEmail,
  replyToContactMessage,
  submitContactMessage,
} from './contact.service.js';

/**
 * The site's contact form, and (once Resend's inbound receiving is
 * configured for the domain) any other mail sent to it.
 *
 * Deliberately not part of `reports` — a general inquiry has no target row
 * to attach to and no moderation queue to enter; it's mail, sent straight to
 * whoever reads `CONTACT_EMAIL`, with the visitor's address set as
 * `replyTo` so a staff reply reaches them without exposing that inbox.
 * Stored, too — `CONTACT_EMAIL` isn't an inbox staff can log into, so the
 * `/contact/messages` routes below are the only way a message is ever
 * actually read or answered.
 */
export const contactController = new Elysia({ prefix: '/contact' })
  .use(sessionContext)
  // Scoped to this one route via `.group()`, not applied to the whole
  // controller: `rateLimit('contact')`'s 5/hour budget is meant to bound
  // anonymous submissions, and must not also throttle staff merely browsing
  // or replying to their own inbox below.
  .group('', (app) =>
    app.use(rateLimit('contact')).post(
      '/',
      async ({ body }) => {
        const to = env().CONTACT_EMAIL;
        if (to === undefined) {
          throw new ServiceUnavailableError('Formularz kontaktowy jest obecnie niedostępny.');
        }

        await submitContactMessage(body);

        const { subject, html, text } = renderContactMessageEmail(body);

        await sendEmail({ to, subject, html, text, replyTo: body.email }, logger);

        return { message: 'Wiadomość została wysłana. Odpowiemy najszybciej, jak to możliwe.' };
      },
      {
        body: ContactMessageRequest,
        response: { 200: ContactMessageResponse },
        detail: {
          summary: 'Send a contact form message',
          description: 'Open to anyone, rate-limited. Stores the message and emails CONTACT_EMAIL with the visitor set as reply-to.',
          tags: ['contact'],
        },
      },
    ),
  )
  .get(
    '/messages',
    async ({ session, query }) => {
      requireModerator(session);
      return listContactMessages(query.status, query.limit ?? 50);
    },
    {
      query: t.Object({
        status: t.Optional(literalUnion(CONTACT_MESSAGE_STATUSES)),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
      }),
      detail: {
        summary: 'The staff contact inbox',
        description: 'Newest first, optionally filtered by status. Each row is the conversation envelope plus its latest message.',
        tags: ['contact'],
      },
    },
  )
  .get(
    '/messages/:id',
    async ({ params, session }) => {
      requireModerator(session);
      return getContactMessageThread(params.id);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: {
        summary: 'One conversation, with its full ordered thread',
        tags: ['contact'],
      },
    },
  )
  .post(
    '/messages/:id/reply',
    async ({ params, body, session }) => {
      const moderator = requireModerator(session);
      return replyToContactMessage(params.id, body.replyText, { actorUserId: moderator.user.id });
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: ContactReplyBody,
      detail: {
        summary: 'Reply to a contact message',
        description: 'Records the reply and emails it to the visitor from CONTACT_EMAIL.',
        tags: ['contact'],
      },
    },
  )
  .post(
    '/webhook',
    async ({ request }) => {
      // The raw body string is what Resend actually signed — re-parsing to
      // JSON and re-serializing can differ byte-for-byte (key order,
      // whitespace) and would silently break verification, so this route
      // takes no `body` schema and reads the text directly.
      const rawBody = await request.text();

      const id = request.headers.get('svix-id');
      const timestamp = request.headers.get('svix-timestamp');
      const signature = request.headers.get('svix-signature');

      if (id === null || timestamp === null || signature === null) {
        throw new AuthenticationError('Brak nagłówków podpisu webhooka.');
      }

      if (!verifyResendWebhook(rawBody, { id, timestamp, signature })) {
        logger.warn('Rejected a Resend webhook with an invalid signature', { module: 'contact' });
        throw new AuthenticationError('Nieprawidłowy podpis webhooka.');
      }

      const event = JSON.parse(rawBody) as { type?: string; data?: { email_id?: string } };

      // Only `email.received` is handled; any other event type this
      // endpoint might receive (or a future one Resend adds) is
      // acknowledged, not processed — an unrecognized type must not
      // become a retry storm from Resend's side.
      if (event.type === 'email.received' && event.data?.email_id !== undefined) {
        await receiveContactEmail(event.data.email_id);
      }

      return { received: true };
    },
    {
      detail: {
        summary: "Resend's inbound-mail webhook",
        description: 'Signature-verified, not session-authenticated. Handles email.received; acknowledges everything else.',
        tags: ['contact'],
      },
    },
  );
