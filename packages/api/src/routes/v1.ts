import { Elysia } from 'elysia';
import { healthController } from '../modules/health/health.controller.js';
import { animeController } from '../modules/anime/anime.controller.js';
import { authController } from '../modules/auth/auth.controller.js';
import { episodesController } from '../modules/episodes/episodes.controller.js';
import { sourcesController } from '../modules/sources/sources.controller.js';
import { reportsController } from '../modules/reports/reports.controller.js';
import { moderationController } from '../modules/moderation/moderation.controller.js';
import { discoveryController } from '../modules/discovery/discovery.controller.js';
import { watchController } from '../modules/episodes/watch.controller.js';
import { playbackController } from '../modules/sources/playback.controller.js';
import { libraryController } from '../modules/library/library.controller.js';
import { profilesController } from '../modules/profiles/profiles.controller.js';
import { engagementController } from '../modules/engagement/engagement.controller.js';
import { notificationsController } from '../modules/notifications/notifications.controller.js';
import { translatorsController } from '../modules/translators/translators.controller.js';
import { adminController } from '../modules/admin/admin.controller.js';
import { catalogueController } from '../modules/catalogue/catalogue.controller.js';
import { realtimeController } from '../modules/realtime/realtime.controller.js';

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
  .use(moderationController)
  .use(discoveryController)
  .use(watchController)
  .use(playbackController)
  .use(libraryController)
  .use(profilesController)
  .use(engagementController)
  .use(notificationsController)
  .use(translatorsController)
  .use(adminController)
  .use(catalogueController)
  .use(realtimeController);
