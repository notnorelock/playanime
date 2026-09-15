/**
 * Slug generation.
 *
 * Handles Polish diacritics explicitly: `Ł`/`ł` do not decompose under NFD, so
 * a bare `normalize('NFD')` strip leaves them intact and produces a slug with a
 * non-ASCII character in it.
 */
const POLISH_MAP: Readonly<Record<string, string>> = {
  ł: 'l',
  Ł: 'L',
};

export function slugify(input: string): string {
  return input
    .replace(/[łŁ]/g, (char) => POLISH_MAP[char] ?? char)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

/** Truncates on a word boundary, appending an ellipsis when shortened. */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  const cut = input.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/** Collapses runs of whitespace and trims. */
export const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();
