import { Elysia, t } from 'elysia';
import {
  ActivityQuery,
  DeleteAccountBody,
  FollowListQuery,
  LibraryQuery,
  PreferencesUpdateBody,
  ProfileUpdateBody,
} from '@playanime/contracts';
import {
  CSRF_COOKIE_NAME,
  clearedCookieAttributes,
  csrfCookieAttributes,
  requireAuth,
  sessionCookieName,
} from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import {
  deleteMyAccount,
  followProfile,
  getActivity,
  getMySanctions,
  getPreferences,
  getProfile,
  getPublicLibrary,
  listFollows,
  unfollowProfile,
  updatePreferences,
  updateProfile,
} from './profiles.service.js';

const UsernameParams = t.Object({ username: t.String({ minLength: 3, maxLength: 32 }) });

export const profilesController = new Elysia()
  .use(sessionContext)
  .get(
    '/profiles/me',
    ({ session }) => {
      const auth = requireAuth(session);
      return getProfile(auth.user.username, auth.user.id);
    },
    { detail: { summary: 'Get current profile', tags: ['profiles'] } },
  )
  .get(
    '/profiles/:username',
    ({ params, session }) => getProfile(params.username, session?.user.id ?? null),
    {
      params: UsernameParams,
      detail: { summary: 'Get public profile', tags: ['profiles'] },
    },
  )
  .patch('/profile', ({ body, session }) => updateProfile(requireAuth(session).user.id, body), {
    body: ProfileUpdateBody,
    detail: { summary: 'Update profile settings', tags: ['profiles'] },
  })
  .get('/preferences', ({ session }) => getPreferences(requireAuth(session).user.id), {
    detail: { summary: 'Get preferences', tags: ['settings'] },
  })
  .get(
    '/profiles/me/sanctions',
    ({ session }) => getMySanctions(requireAuth(session).user.id),
    {
      detail: {
        summary: "Get the caller's own sanction history",
        description: 'Self-scoped only — a user can never see another user\'s sanctions here.',
        tags: ['profiles'],
      },
    },
  )
  .patch('/preferences', ({ body, session }) => updatePreferences(requireAuth(session).user.id, body), {
    body: PreferencesUpdateBody,
    detail: { summary: 'Update preferences', tags: ['settings'] },
  })
  .post(
    '/profiles/:username/follow',
    async ({ params, session, set }) => {
      const auth = requireAuth(session);
      const result = await followProfile(auth.user.id, auth.user.username, params.username);
      set.status = 201;
      return result;
    },
    {
      params: UsernameParams,
      detail: { summary: 'Follow profile', tags: ['profiles'] },
    },
  )
  .delete(
    '/profiles/:username/follow',
    ({ params, session }) => unfollowProfile(requireAuth(session).user.id, params.username),
    {
      params: UsernameParams,
      detail: { summary: 'Unfollow profile', tags: ['profiles'] },
    },
  )
  .get(
    '/profiles/:username/library',
    ({ params, query, session }) =>
      getPublicLibrary(params.username, session?.user.id ?? null, query),
    {
      params: UsernameParams,
      query: LibraryQuery,
      detail: {
        summary: "A profile's public library",
        description: 'Entries the owner has marked private are never included.',
        tags: ['profiles'],
      },
    },
  )
  .get(
    '/profiles/:username/activity',
    ({ params, query, session }) => getActivity(params.username, query, session?.user.id ?? null),
    {
      params: UsernameParams,
      query: ActivityQuery,
      detail: { summary: 'Get public profile activity', tags: ['profiles'] },
    },
  )
  .get(
    '/profiles/:username/:relation',
    ({ params, query, session }) =>
      listFollows(params.username, params.relation, query, session?.user.id ?? null),
    {
      params: t.Object({
        username: t.String({ minLength: 3, maxLength: 32 }),
        relation: t.Union([t.Literal('followers'), t.Literal('following')]),
      }),
      query: FollowListQuery,
      detail: { summary: 'List profile follows', tags: ['profiles'] },
    },
  )
  .delete(
    '/profile',
    async ({ body, session, cookie }) => {
      const auth = requireAuth(session);
      const result = await deleteMyAccount(auth.user.id, body);

      // The account's own sessions are already gone server-side (deleteAccount
      // clears them); the browser's cookie is cleared here too, same as logout,
      // so a stale cookie is never left presenting a now-deleted identity.
      cookie[sessionCookieName()]?.set({ value: '', ...clearedCookieAttributes() });
      cookie[CSRF_COOKIE_NAME]?.set({ value: '', ...csrfCookieAttributes(), maxAge: 0 });

      return result;
    },
    {
      body: DeleteAccountBody,
      detail: {
        summary: "Delete the caller's own account",
        description:
          'Self-service. Scrubs credentials and personal info and anonymizes the account; content the account contributed elsewhere (comments, ratings, catalogue attribution) is left untouched.',
        tags: ['profiles'],
      },
    },
  );
