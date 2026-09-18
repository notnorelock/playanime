/**
 * Email templates.
 *
 * String interpolation, not a templating engine — this package renders one
 * email today. Polish-only: nothing in this codebase sends bilingual email
 * yet, and this app's own UI already defaults to Polish, so matching that is
 * the simplest correct choice rather than inventing a locale story for a
 * single transactional message.
 */

export interface TakedownResolutionEmailInput {
  readonly reference: string;
  readonly titleName: string;
  readonly approved: boolean;
  readonly resolution: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderTakedownResolutionEmail(input: TakedownResolutionEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Twoje zgłoszenie ${input.reference} zostało rozpatrzone`;

  const decisionLine = input.approved
    ? `Tytuł „${input.titleName}” został usunięty z katalogu.`
    : `Nie stwierdziliśmy podstaw do usunięcia tytułu „${input.titleName}” — zgłoszenie zostało odrzucone.`;

  const resolutionLine =
    input.resolution === null || input.resolution.trim().length === 0
      ? ''
      : `\n\nUzasadnienie: ${input.resolution}`;

  const text = `Cześć,\n\nTwoje zgłoszenie o numerze referencyjnym ${input.reference} zostało rozpatrzone.\n\n${decisionLine}${resolutionLine}\n\nZespół PlayAnime`;

  const html = `
    <p>Cześć,</p>
    <p>Twoje zgłoszenie o numerze referencyjnym <strong>${escapeHtml(input.reference)}</strong> zostało rozpatrzone.</p>
    <p>${escapeHtml(decisionLine)}</p>
    ${
      input.resolution === null || input.resolution.trim().length === 0
        ? ''
        : `<p><strong>Uzasadnienie:</strong> ${escapeHtml(input.resolution)}</p>`
    }
    <p>Zespół PlayAnime</p>
  `.trim();

  return { subject, html, text };
}

export interface ContactMessageEmailInput {
  readonly name: string;
  readonly email: string;
  readonly subject: string;
  readonly message: string;
}

/** Renders a visitor's contact-form submission for staff to read — sent TO the site, not a user. */
export function renderContactMessageEmail(input: ContactMessageEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `[Kontakt] ${input.subject}`;

  const text = `Nowa wiadomość z formularza kontaktowego.\n\nOd: ${input.name} <${input.email}>\nTemat: ${input.subject}\n\n${input.message}`;

  const html = `
    <p>Nowa wiadomość z formularza kontaktowego.</p>
    <p><strong>Od:</strong> ${escapeHtml(input.name)} &lt;${escapeHtml(input.email)}&gt;</p>
    <p><strong>Temat:</strong> ${escapeHtml(input.subject)}</p>
    <p>${escapeHtml(input.message).replaceAll('\n', '<br>')}</p>
  `.trim();

  return { subject, html, text };
}
