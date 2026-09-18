/**
 * Thin wrapper over Resend's REST API. No SDK dependency — one call type
 * doesn't need one, and this mirrors `packages/importer/src/deepl-client.ts`'s
 * own choice to call a provider's REST API directly for the same reason.
 *
 * Reads configuration from `@playanime/config` rather than `process.env`
 * directly, unlike the DeepL client: DeepL is only ever used by the
 * standalone import script, but this is called from the running API, which
 * already validates its environment through that shared schema at boot.
 */

import { env } from '@playanime/config';
import type { Logger } from '@playanime/logger';

export interface SendEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Set so a staff reply reaches the actual sender, e.g. a contact form's visitor. */
  readonly replyTo?: string;
  /** Overrides `RESEND_FROM_ADDRESS` — e.g. a contact-form reply sent as `CONTACT_EMAIL` instead. */
  readonly from?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_RECEIVING_ENDPOINT = 'https://api.resend.com/emails/receiving';

interface RawResendSendResponse {
  readonly id?: string;
}

/**
 * Sends one transactional email via Resend.
 *
 * A no-op, not an error, when `RESEND_API_KEY` isn't configured — logged as
 * a warning so the gap is visible without failing whatever triggered the
 * send. Every caller should invoke this the same way
 * `translateUntranslatedTaxonomy` invokes DeepL: fire-and-forget, wrapped in
 * its own try/catch, never allowed to fail the state change it follows.
 *
 * Returns the sent email's Resend id (or `undefined` for the no-op case) —
 * a reply's caller stores it so a later inbound reply's `In-Reply-To`
 * header can be matched back to this exact send.
 */
export async function sendEmail(input: SendEmailInput, logger: Logger): Promise<string | undefined> {
  const apiKey = env().RESEND_API_KEY;
  const fromAddress = env().RESEND_FROM_ADDRESS;

  if (apiKey === undefined || fromAddress === undefined) {
    logger.warn('Skipping email send: RESEND_API_KEY or RESEND_FROM_ADDRESS is not configured.', {
      module: 'email',
    });
    return undefined;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from ?? fromAddress,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo === undefined ? {} : { reply_to: input.replyTo }),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed: ${String(response.status)} ${response.statusText} — ${body}`);
  }

  const parsed = (await response.json()) as RawResendSendResponse;
  return parsed.id;
}

export interface ReceivedEmail {
  readonly id: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string | null;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly messageId: string | null;
}

interface RawReceivedEmailResponse {
  readonly id: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string | null;
  readonly html: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly message_id?: string;
}

/**
 * Fetches one received email's full content from Resend's Receiving API.
 *
 * The webhook that announces a new message (`email.received`) carries only
 * metadata — this is the follow-up call for the actual body and headers
 * (notably `In-Reply-To`, used for thread matching).
 */
export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  const apiKey = env().RESEND_API_KEY;
  if (apiKey === undefined) {
    throw new Error('RESEND_API_KEY is not configured; cannot fetch a received email.');
  }

  const response = await fetch(`${RESEND_RECEIVING_ENDPOINT}/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Resend receiving request failed: ${String(response.status)} ${response.statusText} — ${body}`,
    );
  }

  const parsed = (await response.json()) as RawReceivedEmailResponse;

  return {
    id: parsed.id,
    from: parsed.from,
    to: parsed.to,
    subject: parsed.subject,
    text: parsed.text,
    html: parsed.html,
    headers: parsed.headers ?? {},
    messageId: parsed.message_id ?? null,
  };
}
