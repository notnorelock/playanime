import { Type, type Static } from '@sinclair/typebox';
import { CursorPageOf, CursorQuery, IsoDateTime, literalUnion, Uuid } from '../common/index.js';

/**
 * Support tickets — a logged-in user's own help requests, in a category,
 * replied to by staff from the admin panel.
 *
 * Same envelope+ordered-thread shape as `contact` (see that module's own
 * doc comment for the rationale), but deliberately a separate table:
 * `contact` is anonymous mail with no submitter account behind it and no
 * per-user "my tickets" list; a support ticket always belongs to a real
 * user, is filed under a category, and that user can see the reply
 * in-app (a notification), not only by email.
 */

export const SupportTicketCategory = {
  GENERAL: 'general',
  COLLABORATION: 'collaboration',
  SUPPORT: 'support',
  TECHNICAL: 'technical',
} as const;
export type SupportTicketCategory = (typeof SupportTicketCategory)[keyof typeof SupportTicketCategory];
export const SUPPORT_TICKET_CATEGORIES = Object.values(SupportTicketCategory);

export const SupportTicketStatus = {
  /** The last message in the thread is from the user — staff owes a reply. */
  OPEN: 'open',
  /** The last message in the thread is from staff. */
  REPLIED: 'replied',
  /** Resolved, no further action expected. */
  CLOSED: 'closed',
} as const;
export type SupportTicketStatus = (typeof SupportTicketStatus)[keyof typeof SupportTicketStatus];
export const SUPPORT_TICKET_STATUSES = Object.values(SupportTicketStatus);

export const SupportMessageDirection = {
  /** From the ticket's own submitter. */
  USER: 'user',
  /** From staff, sent via the admin panel. */
  STAFF: 'staff',
} as const;
export type SupportMessageDirection = (typeof SupportMessageDirection)[keyof typeof SupportMessageDirection];
export const SUPPORT_MESSAGE_DIRECTIONS = Object.values(SupportMessageDirection);

export const SupportTicketCreateBody = Type.Object({
  category: literalUnion(SUPPORT_TICKET_CATEGORIES),
  subject: Type.String({ minLength: 1, maxLength: 200 }),
  message: Type.String({ minLength: 1, maxLength: 5000 }),
});
export type SupportTicketCreateBody = Static<typeof SupportTicketCreateBody>;

/** One message in a ticket's thread, in either direction. */
export const SupportMessageEntryDto = Type.Object({
  id: Uuid,
  direction: literalUnion(SUPPORT_MESSAGE_DIRECTIONS),
  body: Type.String(),
  sentByUsername: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type SupportMessageEntryDto = Static<typeof SupportMessageEntryDto>;

/** A ticket as a list (the user's own "my tickets", or the staff queue) shows it — envelope plus the latest message only. */
export const SupportTicketDto = Type.Object({
  id: Uuid,
  category: literalUnion(SUPPORT_TICKET_CATEGORIES),
  subject: Type.String(),
  status: literalUnion(SUPPORT_TICKET_STATUSES),
  submitterUsername: Type.String(),
  lastMessage: Type.String(),
  createdAt: IsoDateTime,
});
export type SupportTicketDto = Static<typeof SupportTicketDto>;

/** A ticket with its full, ordered thread — for the detail/reply view. */
export const SupportTicketThreadDto = Type.Object({
  id: Uuid,
  category: literalUnion(SUPPORT_TICKET_CATEGORIES),
  subject: Type.String(),
  status: literalUnion(SUPPORT_TICKET_STATUSES),
  submitterUsername: Type.String(),
  createdAt: IsoDateTime,
  messages: Type.Array(SupportMessageEntryDto),
});
export type SupportTicketThreadDto = Static<typeof SupportTicketThreadDto>;

export const SupportTicketReplyBody = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 5000 }),
});
export type SupportTicketReplyBody = Static<typeof SupportTicketReplyBody>;

/** Staff-only: close a ticket with no further reply. */
export const SupportTicketQuery = Type.Object({
  ...CursorQuery.properties,
  status: Type.Optional(literalUnion(SUPPORT_TICKET_STATUSES)),
});
export type SupportTicketQuery = Static<typeof SupportTicketQuery>;

export const SupportTicketPage = CursorPageOf(SupportTicketDto);
export type SupportTicketPage = Static<typeof SupportTicketPage>;
