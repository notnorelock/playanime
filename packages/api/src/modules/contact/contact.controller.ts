import { Elysia } from 'elysia';
import { ContactMessageRequest, ContactMessageResponse } from '@playanime/contracts';
import { ServiceUnavailableError } from '@playanime/shared';
import { env } from '@playanime/config';
import { renderContactMessageEmail, sendEmail } from '@playanime/email';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { logger } from '../../plugins/error-handler.js';

/**
 * The site's contact form.
 *
 * Deliberately not part of `reports` — a general inquiry has no target row
 * to attach to and no moderation queue to enter; it's mail, sent straight to
 * whoever reads `CONTACT_EMAIL`, with the visitor's address set as
 * `replyTo` so a staff reply reaches them without exposing that inbox.
 */
export const contactController = new Elysia({ prefix: '/contact' })
  .use(sessionContext)
  .use(rateLimit('contact'))
  .post(
    '/',
    async ({ body }) => {
      const to = env().CONTACT_EMAIL;
      if (to === undefined) {
        throw new ServiceUnavailableError('Formularz kontaktowy jest obecnie niedostępny.');
      }

      const { subject, html, text } = renderContactMessageEmail(body);

      await sendEmail({ to, subject, html, text, replyTo: body.email }, logger);

      return { message: 'Wiadomość została wysłana. Odpowiemy najszybciej, jak to możliwe.' };
    },
    {
      body: ContactMessageRequest,
      response: { 200: ContactMessageResponse },
      detail: {
        summary: 'Send a contact form message',
        description: 'Open to anyone, rate-limited. Emails CONTACT_EMAIL with the visitor set as reply-to.',
        tags: ['contact'],
      },
    },
  );
