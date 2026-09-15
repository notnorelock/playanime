import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, resolving Tailwind conflicts.
 *
 * `clsx` flattens conditionals and arrays; `twMerge` then resolves competing
 * utilities so a caller's `class` genuinely overrides the component's default.
 * Without the merge, `<Button class="bg-rose-400">` would emit both background
 * utilities and the winner would depend on stylesheet order rather than intent.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
