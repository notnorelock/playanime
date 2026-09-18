/**
 * Schema barrel.
 *
 * Split by domain rather than kept as one file: a single `schema.ts` grows past
 * a thousand lines quickly and every migration then produces an unreviewable
 * diff. Drizzle Kit reads this barrel, so the split costs nothing at build time.
 *
 * Cross-domain foreign keys are allowed and expected. What is not allowed is a
 * cycle between domain *files* — imports run users -> auth, anime -> sources,
 * and both -> lists, never back.
 */

export * from './_shared.js';
export * from './users.js';
export * from './devices.js';
export * from './auth.js';
export * from './anime.js';
export * from './sources.js';
export * from './lists.js';
export * from './translators.js';
export * from './moderation.js';
export * from './watch-parties.js';
export * from './notifications.js';
export * from './security.js';
export * from './contact.js';
