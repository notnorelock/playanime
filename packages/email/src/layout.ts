import { env } from '@playanime/config';

/**
 * Shared HTML email shell.
 *
 * Table-based layout, inline styles only, no external stylesheet — this is
 * the actual constraint set email clients support consistently (Outlook
 * desktop renders with Word's engine, which ignores most modern CSS
 * entirely). Every template wraps its own inner content with `renderLayout`
 * rather than building a full `<html>` document itself, so the header/logo/
 * footer stay in exactly one place.
 *
 * The logo is served from `packages/web/public/playa-logo.svg` — copied
 * there specifically for a stable, unhashed URL (Vite fingerprints
 * everything under `src/assets/`), reachable at `${WEB_URL}/playa-logo.svg`
 * in every environment without a build step.
 */

const BRAND_COLOR = '#f47521';
const BACKGROUND_COLOR = '#0f0f0f';
const CARD_COLOR = '#1a1a1a';
const TEXT_COLOR = '#e5e5e5';
const MUTED_COLOR = '#9a9a9a';
const BORDER_COLOR = '#2a2a2a';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** A prominent call-to-action button, styled inline since email clients ignore `<button>`. */
export function emailButton(label: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
      <tr>
        <td style="border-radius: 8px; background: ${BRAND_COLOR};">
          <a href="${escapeHtml(href)}" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/** A large, letter-spaced code block — used for the verification code. */
export function emailCodeBlock(code: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0;">
      <tr>
        <td align="center" style="background: ${BACKGROUND_COLOR}; border: 1px solid ${BORDER_COLOR}; border-radius: 8px; padding: 20px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: ${BRAND_COLOR}; font-family: 'Courier New', Courier, monospace;">
            ${escapeHtml(code)}
          </span>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Wraps inner HTML (already-escaped, template-composed markup) with the
 * shared header/card/footer shell. `preheader` is the short hidden summary
 * most clients show next to the subject line in an inbox list.
 */
export function renderLayout(innerHtml: string, preheader: string): string {
  const logoUrl = `${env().WEB_URL}/playa-logo.svg`;

  return `
<!DOCTYPE html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PlayAnime</title>
  </head>
  <body style="margin: 0; padding: 0; background: ${BACKGROUND_COLOR}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <!-- Preheader: hidden, but shown by inbox list previews -->
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
      ${escapeHtml(preheader)}
    </div>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background: ${BACKGROUND_COLOR};">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px;">
            <!-- Logo header -->
            <tr>
              <td align="center" style="padding-bottom: 24px;">
                <img src="${escapeHtml(logoUrl)}" alt="PlayAnime" width="40" height="40" style="display: block;" />
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background: ${CARD_COLOR}; border: 1px solid ${BORDER_COLOR}; border-radius: 12px; padding: 32px 28px; color: ${TEXT_COLOR}; font-size: 15px; line-height: 1.6;">
                ${innerHtml}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding-top: 24px; color: ${MUTED_COLOR}; font-size: 12px;">
                PlayAnime
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}
