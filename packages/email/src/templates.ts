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
