import { Elysia, t } from 'elysia';
import { AvatarUploadResponse } from '@playanime/contracts';
import { requireAuth } from '@playanime/auth';
import { UnsupportedMediaTypeError } from '@playanime/shared';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { uploadAvatar } from './media.service.js';

export const mediaController = new Elysia()
  .use(sessionContext)
  .use(rateLimit('avatarUpload'))
  .post(
    '/media/avatar',
    async ({ body, session, set }) => {
      requireAuth(session);

      if (body.file instanceof File === false) {
        throw new UnsupportedMediaTypeError('No file was uploaded.');
      }

      const result = await uploadAvatar(await body.file.arrayBuffer());
      set.status = 201;
      return result;
    },
    {
      body: t.Object({ file: t.File() }),
      response: AvatarUploadResponse,
      detail: {
        summary: 'Upload an avatar image',
        description:
          'Converts the upload to WebP (animation preserved) and stores it, returning a URL. Does not itself change the caller\'s avatar — pass the returned URL to PATCH /profile\'s avatar field to actually set it.',
        tags: ['profiles'],
      },
    },
  );
