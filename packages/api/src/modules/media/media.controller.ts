import { Elysia, t } from 'elysia';
import { AvatarHistoryResponse, AvatarUploadResponse } from '@playanime/contracts';
import { requireAuth } from '@playanime/auth';
import { UnsupportedMediaTypeError } from '@playanime/shared';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { activateAvatarUpload, deleteAvatarUpload, getAvatarHistory, uploadAvatar } from './media.service.js';

export const mediaController = new Elysia()
  .use(sessionContext)
  .use(rateLimit('avatarUpload'))
  .post(
    '/media/avatar',
    async ({ body, session, set }) => {
      const auth = requireAuth(session);

      if (body.file instanceof File === false) {
        throw new UnsupportedMediaTypeError('No file was uploaded.');
      }

      const result = await uploadAvatar(auth.user.id, await body.file.arrayBuffer());
      set.status = 201;
      return result;
    },
    {
      body: t.Object({ file: t.File() }),
      response: AvatarUploadResponse,
      detail: {
        summary: 'Upload an avatar image',
        description:
          'Converts the upload to WebP (animation preserved), generates size variants (64/128/256/512), and activates it as the caller\'s current avatar in one step. Expects an already-cropped square image — cropping happens client-side.',
        tags: ['profiles'],
      },
    },
  )
  .get(
    '/profile/avatar-history',
    async ({ session }) => {
      const auth = requireAuth(session);
      const items = await getAvatarHistory(auth.user.id);
      return { items };
    },
    {
      response: AvatarHistoryResponse,
      detail: {
        summary: "The caller's own avatar upload history",
        description: 'Every upload kept until explicitly deleted — never auto-pruned.',
        tags: ['profiles'],
      },
    },
  )
  .post(
    '/media/avatar/:id/activate',
    async ({ params, session }) => {
      const auth = requireAuth(session);
      return activateAvatarUpload(auth.user.id, params.id);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: AvatarUploadResponse,
      detail: {
        summary: 'Re-activate a past upload as the current avatar',
        description: "404s for another user's upload id, same as a nonexistent one.",
        tags: ['profiles'],
      },
    },
  )
  .delete(
    '/media/avatar/:id',
    async ({ params, session }) => {
      const auth = requireAuth(session);
      return deleteAvatarUpload(auth.user.id, params.id);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: {
        summary: 'Permanently delete one of the caller\'s own avatar uploads',
        description: 'The only pruning mechanism — history is otherwise kept forever.',
        tags: ['profiles'],
      },
    },
  );
