/** Duration helpers. Named constants beat `60 * 60 * 24 * 7` at the call site. */
export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

export const seconds = (n: number): number => n * SECOND_MS;
export const minutes = (n: number): number => n * MINUTE_MS;
export const hours = (n: number): number => n * HOUR_MS;
export const days = (n: number): number => n * DAY_MS;

export const toSeconds = (ms: number): number => Math.floor(ms / SECOND_MS);

/** Current time. Centralized so tests can stub a single seam. */
export const now = (): Date => new Date();
export const nowMs = (): number => Date.now();

export const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms);
export const isPast = (date: Date, reference: Date = now()): boolean => date.getTime() < reference.getTime();

/** Formats seconds as `H:MM:SS` or `M:SS` — episode runtimes and player UI. */
export function formatRuntime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;

  const pad = (n: number): string => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
