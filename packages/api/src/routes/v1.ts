import { Elysia } from 'elysia';
import { healthController } from '../modules/health/health.controller.js';
import { animeController } from '../modules/anime/anime.controller.js';
import { authController } from '../modules/auth/auth.controller.js';
import { episodesController } from '../modules/episodes/episodes.controller.js';
import { sourcesController } from '../modules/sources/sources.controller.js';
import { reportsController } from '../modules/reports/reports.controller.js';
import { moderationController } from '../modules/moderation/moderation.controller.js';

/**
 * API version 1.
 *
 * The version prefix is applied once, here. Spreading `/v1` through individual
 * route definitions makes introducing v2 a find-and-replace across the codebase
 * and guarantees one route gets missed — mounting a whole tree under a prefix
 * means v2 is a new file that reuses whichever controllers are unchanged.
 */
export const v1 = new Elysia({ prefix: '/api/v1' })
  .use(healthController)
  .use(authController)
  .use(animeController)
  .use(episodesController)
  .use(sourcesController)
  .use(reportsController)
  .use(moderationController);
