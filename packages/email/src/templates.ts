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

export interface EpisodeReportReplyEmailInput {
  readonly animeTitle: string;
  readonly episodeNumber: number;
  readonly status: 'action_taken' | 'dismissed';
  readonly replyText: string | null;
}

/** Sent when staff resolves a "report episode" submission — status plus an optional reply, matching the takedown-resolution email's shape. */
export function renderEpisodeReportReplyEmail(input: EpisodeReportReplyEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const episodeLabel = `${input.animeTitle}, odcinek ${String(input.episodeNumber)}`;
  const subject = `Twoje zgłoszenie odcinka zostało rozpatrzone — ${input.animeTitle}`;

  const statusLine =
    input.status === 'action_taken'
      ? `Zgłoszony problem z odcinkiem (${episodeLabel}) został potwierdzony i naprawiony.`
      : `Nie potwierdziliśmy problemu ze zgłoszonym odcinkiem (${episodeLabel}).`;

  const replyLine = input.replyText === null || input.replyText.trim().length === 0 ? '' : `\n\n${input.replyText}`;

  const text = `Cześć,\n\n${statusLine}${replyLine}\n\nZespół PlayAnime`;

  const inner = `
    <p style="margin: 0 0 16px;">Cześć,</p>
    <p style="margin: 0 0 16px;">${escapeHtml(statusLine)}</p>
    ${
      input.replyText === null || input.replyText.trim().length === 0
        ? ''
        : `<p style="margin: 0; white-space: pre-wrap;">${escapeHtml(input.replyText)}</p>`
    }
  `;

  return {
    subject,
    html: renderLayout(inner, statusLine),
    text,
  };
}

export interface ContactReplyEmailInput {
  readonly subject: string;
  readonly originalMessage: string;
  readonly replyText: string;
}

/** A staff reply to a contact-form submission — quotes the original so the visitor has context. */
export function renderContactReplyEmail(input: ContactReplyEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = input.subject.startsWith('Re:') ? input.subject : `Re: ${input.subject}`;

  const text = `${input.replyText}\n\n---\nTwoja wiadomość:\n${input.originalMessage}\n\nZespół PlayAnime`;

  const inner = `
    <p style="margin: 0 0 20px; white-space: pre-wrap;">${escapeHtml(input.replyText)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 8px;">
      <tr>
        <td style="border-left: 3px solid #2a2a2a; padding: 4px 0 4px 14px; color: #9a9a9a; font-size: 13px; white-space: pre-wrap;">
          ${escapeHtml(input.originalMessage)}
        </td>
      </tr>
    </table>
    <p style="margin: 20px 0 0;">Zespół PlayAnime</p>
  `;

  return {
    subject,
    html: renderLayout(inner, input.replyText.slice(0, 120)),
    text,
  };
}
