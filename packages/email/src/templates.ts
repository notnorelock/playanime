/**
 * Email templates.
 *
 * Each renderer composes inner markup and hands it to `renderLayout`
 * (`layout.ts`) for the shared header/card/footer shell — string
 * interpolation, not a templating engine, since this package renders a
 * handful of emails, not an open-ended set. Polish-only: nothing in this
 * codebase sends bilingual email yet, and this app's own UI already
 * defaults to Polish, so matching that is the simplest correct choice
 * rather than inventing a locale story for a few transactional messages.
 */

import { emailButton, emailCodeBlock, escapeHtml, renderLayout } from './layout.js';

export interface TakedownResolutionEmailInput {
  readonly reference: string;
  readonly titleName: string;
  readonly approved: boolean;
  readonly resolution: string | null;
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

  const inner = `
    <p style="margin: 0 0 16px;">Cześć,</p>
    <p style="margin: 0 0 16px;">Twoje zgłoszenie o numerze referencyjnym <strong>${escapeHtml(input.reference)}</strong> zostało rozpatrzone.</p>
    <p style="margin: 0 0 16px;">${escapeHtml(decisionLine)}</p>
    ${
      input.resolution === null || input.resolution.trim().length === 0
        ? ''
        : `<p style="margin: 0;"><strong>Uzasadnienie:</strong> ${escapeHtml(input.resolution)}</p>`
    }
  `;

  return {
    subject,
    html: renderLayout(inner, decisionLine),
    text,
  };
}

export interface VerificationEmailInput {
  readonly code: string;
  readonly verifyUrl: string;
}

/** The 6-digit code shown large, plus a button that pre-fills and auto-submits the same code. */
export function renderVerificationEmail(input: VerificationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Potwierdź swój adres e-mail w PlayAnime';

  const text = `Cześć,\n\nTwój kod potwierdzający to: ${input.code}\n\nWpisz go na stronie, aby potwierdzić adres e-mail, albo kliknij poniższy link:\n${input.verifyUrl}\n\nKod jest ważny przez 15 minut.\n\nZespół PlayAnime`;

  const inner = `
    <p style="margin: 0 0 16px;">Cześć,</p>
    <p style="margin: 0 0 8px;">Twój kod potwierdzający adres e-mail:</p>
    ${emailCodeBlock(input.code)}
    ${emailButton('Potwierdź adres e-mail', input.verifyUrl)}
    <p style="margin: 16px 0 0; color: #9a9a9a; font-size: 13px;">Kod jest ważny przez 15 minut. Jeśli to nie Ty próbowałeś/aś się zarejestrować, zignoruj tę wiadomość.</p>
  `;

  return {
    subject,
    html: renderLayout(inner, `Twój kod potwierdzający: ${input.code}`),
    text,
  };
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

  const inner = `
    <p style="margin: 0 0 16px;">Nowa wiadomość z formularza kontaktowego.</p>
    <p style="margin: 0 0 8px;"><strong>Od:</strong> ${escapeHtml(input.name)} &lt;${escapeHtml(input.email)}&gt;</p>
    <p style="margin: 0 0 16px;"><strong>Temat:</strong> ${escapeHtml(input.subject)}</p>
    <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(input.message)}</p>
  `;

  return {
    subject,
    html: renderLayout(inner, `Nowa wiadomość od ${input.name}: ${input.subject}`),
    text,
  };
}
