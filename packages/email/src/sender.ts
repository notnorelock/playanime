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
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Sends one transactional email via Resend.
 *
 * A no-op, not an error, when `RESEND_API_KEY` isn't configured — logged as
 * a warning so the gap is visible without failing whatever triggered the
 * send. Every caller should invoke this the same way
 * `translateUntranslatedTaxonomy` invokes DeepL: fire-and-forget, wrapped in
 * its own try/catch, never allowed to fail the state change it follows.
 */
export async function sendEmail(input: SendEmailInput, logger: Logger): Promise<void> {
  const apiKey = env().RESEND_API_KEY;
  const fromAddress = env().RESEND_FROM_ADDRESS;

  if (apiKey === undefined || fromAddress === undefined) {
    logger.warn('Skipping email send: RESEND_API_KEY or RESEND_FROM_ADDRESS is not configured.', {
      module: 'email',
    });
    return;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend request failed: ${String(response.status)} ${response.statusText} — ${body}`);
  }
}
