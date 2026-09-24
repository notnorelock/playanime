import { Elysia } from 'elysia';
import { AnnouncementSetBody } from '@playanime/contracts';
import { requireAdmin } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import { clearAnnouncement, getActiveAnnouncement, listAnnouncements, setAnnouncement } from './announcements.service.js';

/** The homepage announcement strip — public read, admin-only write. See the schema's own doc comment for the one-active-row-at-a-time design. */
export const announcementsController = new Elysia({ prefix: '/announcements' })
  .use(sessionContext)
  .get('/active', () => getActiveAnnouncement(), {
    detail: {
      summary: 'The current homepage announcement',
      description: 'Null when there is none. No auth required — same audience as the homepage itself.',
      tags: ['announcements'],
    },
  })
  .get(
    '/history',
    ({ session }) => {
      requireAdmin(session);
      return listAnnouncements();
    },
    {
      detail: { summary: 'Every announcement ever set, newest first', tags: ['announcements'] },
    },
  )
  .post(
    '/',
    ({ body, session, set }) => {
      const auth = requireAdmin(session);
      set.status = 201;
      return setAnnouncement(auth.user.id, body);
    },
    {
      body: AnnouncementSetBody,
      detail: {
        summary: 'Set the homepage announcement',
        description: 'Replaces whatever was active before.',
        tags: ['announcements'],
      },
    },
  )
  .delete(
    '/',
    ({ session }) => {
      const auth = requireAdmin(session);
      return clearAnnouncement(auth.user.id);
    },
    {
      detail: { summary: 'Clear the homepage announcement', tags: ['announcements'] },
    },
  );
