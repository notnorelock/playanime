import { Elysia, t } from 'elysia';
import {
  CursorQuery,
  TranslatorAnimeUpsertBody,
  TranslatorApplicationCreateBody,
  TranslatorApplicationDecisionBody,
  TranslatorGroupCreateBody,
  TranslatorGroupQuery,
  TranslatorGroupUpdateBody,
  TranslatorMemberInviteBody,
  TranslatorMemberUpsertBody,
  TranslatorSlugParams,
} from '@playanime/contracts';
import { requireAuth, requireVerifiedEmail } from '@playanime/auth';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import {
  addTitle,
  applyToGroup,
  createGroup,
  decideApplication,
  deleteGroup,
  getGroup,
  inviteMember,
  listApplications,
  listGroups,
  listMyGroups,
  removeMember,
  removeTitle,
  updateGroup,
  updateMember,
  withdrawApplication,
} from './translators.service.js';

/**
 * Fansub group routes.
 *
 * Reading a group is public — attribution is the point of the feature, and
 * hiding it behind a login would defeat it. Every mutation is authenticated,
 * and authorization is decided inside the service against group membership
 * rather than against the platform role.
 */

const UserIdParams = t.Object({
  slug: TranslatorSlugParams.properties.slug,
  userId: t.String({ format: 'uuid' }),
});

export const translatorsController = new Elysia({ prefix: '/translators' })
  .use(sessionContext)
  .get('/', ({ query }) => listGroups(query), {
    query: TranslatorGroupQuery,
    detail: {
      summary: 'List translator groups',
      description: 'Cursor-paginated directory. Suspended and deleted groups are never returned.',
      tags: ['translators'],
    },
  })
  /*
   * Declared before `/:slug` so the literal path wins: Elysia would otherwise
   * match "mine" as a slug and return 404 for a route that exists.
   */
  .get('/mine', ({ session }) => listMyGroups(requireAuth(session).user.id), {
    detail: { summary: 'Groups the current user belongs to', tags: ['translators'] },
  })
  .group('', (app) =>
    app.use(rateLimit('createTranslatorGroup')).post(
      '/',
      async ({ body, session, set }) => {
        // Verified email required: a group is a public identity, and creating
        // one from a throwaway account is how impersonation starts.
        const authenticated = requireVerifiedEmail(session);
        const group = await createGroup(authenticated.user.id, body);
        set.status = 201;
        return group;
      },
      {
        body: TranslatorGroupCreateBody,
        detail: {
          summary: 'Create a translator group',
          description:
            'The creator becomes the first leader. The slug is derived server-side from the name.',
          tags: ['translators'],
        },
      },
    ),
  )
  .get('/:slug', ({ params, session }) => getGroup(params.slug, session?.user.id ?? null), {
    params: TranslatorSlugParams,
    detail: {
      summary: 'Get a translator group',
      description: "Includes the viewer's own role in the group, so the UI needs no second call.",
      tags: ['translators'],
    },
  })
  .patch(
    '/:slug',
    ({ params, body, session }) => updateGroup(params.slug, requireAuth(session).user.id, body),
    {
      params: TranslatorSlugParams,
      body: TranslatorGroupUpdateBody,
      detail: {
        summary: 'Update group settings',
        description: 'Leaders only. Name and slug are deliberately not editable here.',
        tags: ['translators'],
      },
    },
  )
  .delete('/:slug', ({ params, session }) => deleteGroup(params.slug, requireAuth(session).user.id), {
    params: TranslatorSlugParams,
    detail: {
      summary: 'Disband a group',
      description: 'Soft delete: credits are retained so existing attribution survives.',
      tags: ['translators'],
    },
  })

  /* ---------------------------------------------------------------- */
  /* Members                                                           */
  /* ---------------------------------------------------------------- */

  .post(
    '/:slug/members',
    async ({ params, body, session, set }) => {
      const group = await inviteMember(params.slug, requireAuth(session).user.id, body);
      set.status = 201;
      return group;
    },
    {
      params: TranslatorSlugParams,
      body: TranslatorMemberInviteBody,
      detail: { summary: 'Add a member by username', tags: ['translators'] },
    },
  )
  .patch(
    '/:slug/members/:userId',
    ({ params, body, session }) =>
      updateMember(params.slug, requireAuth(session).user.id, params.userId, body),
    {
      params: UserIdParams,
      body: TranslatorMemberUpsertBody,
      detail: {
        summary: 'Change a member role or credit',
        description: 'Refuses to demote the last leader.',
        tags: ['translators'],
      },
    },
  )
  .delete(
    '/:slug/members/:userId',
    ({ params, session }) =>
      removeMember(params.slug, requireAuth(session).user.id, params.userId),
    {
      params: UserIdParams,
      detail: {
        summary: 'Remove a member',
        description: 'A member may always remove themselves; removing another requires leadership.',
        tags: ['translators'],
      },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Titles                                                            */
  /* ---------------------------------------------------------------- */

  .post(
    '/:slug/anime',
    async ({ params, body, session, set }) => {
      const group = await addTitle(params.slug, requireAuth(session).user.id, body);
      set.status = 201;
      return group;
    },
    {
      params: TranslatorSlugParams,
      body: TranslatorAnimeUpsertBody,
      detail: {
        summary: 'Claim a title for the group',
        description: 'The stated episode range is the group\'s own words and is not verified.',
        tags: ['translators'],
      },
    },
  )
  .delete(
    '/:slug/anime/:animeId',
    ({ params, session }) =>
      removeTitle(params.slug, requireAuth(session).user.id, params.animeId),
    {
      params: t.Object({
        slug: TranslatorSlugParams.properties.slug,
        animeId: t.String({ format: 'uuid' }),
      }),
      detail: { summary: 'Remove a title claim', tags: ['translators'] },
    },
  )

  /* ---------------------------------------------------------------- */
  /* Applications                                                      */
  /* ---------------------------------------------------------------- */

  .post(
    '/:slug/applications',
    async ({ params, body, session, set }) => {
      const result = await applyToGroup(params.slug, requireVerifiedEmail(session).user.id, body);
      set.status = 201;
      return result;
    },
    {
      params: TranslatorSlugParams,
      body: TranslatorApplicationCreateBody,
      detail: {
        summary: 'Apply to join a group',
        description: 'Only while the group is recruiting. One open application per user per group.',
        tags: ['translators'],
      },
    },
  )
  .get(
    '/:slug/applications',
    ({ params, query, session }) =>
      listApplications(params.slug, requireAuth(session).user.id, query),
    {
      params: TranslatorSlugParams,
      query: t.Object({
        ...CursorQuery.properties,
        status: t.Optional(
          t.Union([
            t.Literal('pending'),
            t.Literal('accepted'),
            t.Literal('rejected'),
            t.Literal('withdrawn'),
          ]),
        ),
      }),
      detail: { summary: 'List applications to a group', tags: ['translators'] },
    },
  )
  .post(
    '/:slug/applications/:applicationId/decision',
    ({ params, body, session }) =>
      decideApplication(params.slug, requireAuth(session).user.id, params.applicationId, body),
    {
      params: t.Object({
        slug: TranslatorSlugParams.properties.slug,
        applicationId: t.String({ format: 'uuid' }),
      }),
      body: TranslatorApplicationDecisionBody,
      detail: {
        summary: 'Accept or reject an application',
        description: 'Leaders only. Accepting adds the member and notifies the applicant.',
        tags: ['translators'],
      },
    },
  )
  .delete(
    '/applications/:applicationId',
    ({ params, session }) =>
      withdrawApplication(requireAuth(session).user.id, params.applicationId),
    {
      params: t.Object({ applicationId: t.String({ format: 'uuid' }) }),
      detail: { summary: 'Withdraw your own application', tags: ['translators'] },
    },
  );
