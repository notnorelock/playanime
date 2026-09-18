import { Elysia, t } from 'elysia';
import {
  REPORT_TARGET_TYPES,
  ReportDecisionRequest,
  ReportSubmissionRequest,
  ReportSubmissionResponse,
  ReportType,
  literalUnion,
} from '@playanime/contracts';
import { ValidationError, now } from '@playanime/shared';
import { requireModerator } from '@playanime/auth';
import { db, reports } from '@playanime/database';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { decideReport, listPendingReports } from './reports.service.js';

/**
 * Content reporting.
 *
 * Anonymous submission is supported deliberately. A rights holder is usually
 * not a registered user, and requiring an account before a copyright complaint
 * can be filed would make the takedown path unusable for exactly the people who
 * most need it — which is not a defensible position for a platform hosting
 * third-party links.
 */

/** Short, unambiguous reference the reporter can quote. */
function generateReference(): string {
  // Excludes I, O, 0, 1: these are misread when a reference is copied by hand
  // from an email into a support form.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';

  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length] ?? 'X';
  }

  return `RPT-${suffix}`;
}

export const reportsController = new Elysia({ prefix: '/reports' })
  .use(sessionContext)
  .use(rateLimit('submitReport'))
  .post(
    '/',
    async ({ body, session, clientIp, set }) => {
      // An anonymous reporter must leave a contact address, or the complaint
      // cannot be acknowledged or followed up. JSON Schema cannot express a
      // rule that depends on the session, so it is enforced here.
      if (session === null && body.reporterEmail === undefined) {
        throw new ValidationError('Podaj adres e-mail, abyśmy mogli odpowiedzieć na zgłoszenie.', [
          { path: 'reporterEmail', message: 'Wymagany dla zgłoszeń anonimowych.' },
        ]);
      }

      // A copyright complaint carries legal weight, so the good-faith
      // affirmation is mandatory for that type specifically.
      if (body.type === ReportType.COPYRIGHT && body.rightsHolderAttested !== true) {
        throw new ValidationError(
          'Zgłoszenie naruszenia praw autorskich wymaga potwierdzenia działania w dobrej wierze.',
          [{ path: 'rightsHolderAttested', message: 'Wymagane potwierdzenie.' }],
        );
      }

      const reference = generateReference();

      const [created] = await db()
        .insert(reports)
        .values({
          reference,
          type: body.type,
          targetType: body.targetType,
          targetId: body.targetId,
          reporterUserId: session?.user.id ?? null,
          // An authenticated reporter is identified by their account; the
          // submitted address is ignored rather than trusted.
          reporterEmail: session === null ? (body.reporterEmail ?? null) : null,
          reporterName: body.contactName ?? null,
          reporterIpAddress: clientIp,
          reason: body.reason,
          description: body.description ?? null,
          rightsHolderAttestedAt: body.rightsHolderAttested === true ? now() : null,
        })
        .returning({ id: reports.id, status: reports.status });

      if (created === undefined) throw new Error('Report insert returned no row.');

      set.status = 201;

      return {
        id: created.id,
        status: created.status,
        reference,
        message:
          'Zgłoszenie zostało przyjęte. Zachowaj numer referencyjny do dalszej korespondencji.',
      };
    },
    {
      body: ReportSubmissionRequest,
      response: { 201: ReportSubmissionResponse },
      detail: {
        summary: 'Submit a content report',
        description:
          'Open to anonymous reporters, who must supply a contact address. Copyright complaints require a good-faith attestation and route to a separate moderation queue.',
        tags: ['reports'],
      },
    },
  )
  .get(
    '/pending',
    async ({ session, query }) => {
      requireModerator(session);
      return listPendingReports(query.targetType, query.limit ?? 50);
    },
    {
      query: t.Object({
        targetType: t.Optional(literalUnion(REPORT_TARGET_TYPES)),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
      }),
      detail: {
        summary: 'Pending report queue',
        description: 'Open and under-review reports, oldest first — the takedown/moderation review queue.',
        tags: ['reports'],
      },
    },
  )
  .post(
    '/:reportId/decision',
    async ({ params, body, session, clientIp }) => {
      const moderator = requireModerator(session);
      return decideReport(params.reportId, body, {
        actorUserId: moderator.user.id,
        actorIpAddress: clientIp,
      });
    },
    {
      params: t.Object({ reportId: t.String({ format: 'uuid' }) }),
      body: ReportDecisionRequest,
      detail: {
        summary: 'Decide a report',
        description:
          'Approving an anime-targeted report hides the title and blocks its AniList/MAL id from resubmission. Rejecting dismisses the report with no catalogue write.',
        tags: ['reports'],
      },
    },
  );
