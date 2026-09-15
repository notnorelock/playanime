import { Elysia, t } from 'elysia';
import { SourceSubmissionRequest } from '@playanime/contracts';
import { requireVerifiedEmail } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { listSources, previewSource, submitSource } from './sources.service.js';

/**
 * Episode source routes.
 *
 * Listing returns approved sources with their metadata and provider. It does
 * not return playback URLs — the listing describes what exists, and playback
 * resolution is a separate concern.
 */
export const sourcesController = new Elysia({ prefix: '/episodes/:episodeId' })
  .use(sessionContext)
  .get(
    '/sources',
    async ({ params, session }) =>
      listSources(params.episodeId, {
        preferredAudioLanguage: session?.preferences.preferredAudioLanguage ?? null,
        preferredSubtitleLanguage: session?.preferences.preferredSubtitleLanguage ?? null,
      }),
    {
      params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
      detail: {
        summary: 'List approved sources for an episode',
        description:
          'Ranked server-side by verification, availability, language match and provider reliability. Only sources with status `active` are returned.',
        tags: ['sources'],
      },
    },
  )
  .group('', (app) =>
    app.use(rateLimit('submitSource')).post(
      '/sources',
      async ({ params, body, session, clientIp, set }) => {
        // Verified email required: submissions create moderation work, and an
        // unverified throwaway account should not be able to generate it.
        const authenticated = requireVerifiedEmail(session);

        const result = await submitSource(params.episodeId, body, {
          userId: authenticated.user.id,
          ipAddress: clientIp,
        });

        set.status = 201;
        return result;
      },
      {
        params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
        body: SourceSubmissionRequest,
        detail: {
          summary: 'Submit an external source',
          description:
            'Requires an explicit rights attestation, which is stored verbatim with a timestamp. The source enters moderation as `pending` and is invisible to viewers until approved.',
          tags: ['sources'],
        },
      },
    ),
  )
  .post(
    '/sources/preview',
    async ({ params, body, session }) => {
      requireVerifiedEmail(session);
      return previewSource(params.episodeId, body.url);
    },
    {
      params: t.Object({ episodeId: t.String({ format: 'uuid' }) }),
      body: t.Object({ url: t.String({ maxLength: 2048 }) }),
      detail: {
        summary: 'Preview a URL before submitting',
        description:
          'Parses and normalizes without storing, so the submitter can confirm the detected provider and see whether the resource already exists.',
        tags: ['sources'],
      },
    },
  );
