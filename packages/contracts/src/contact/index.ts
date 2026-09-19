import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, literalUnion, Uuid } from '../common/index.js';

/**
 * Contact form and inbound email.
 *
 * Deliberately separate from `reports` — a general inquiry ("can I advertise
 * with you", "I found a UI bug") has no moderation queue to enter and no
 * target row to attach to; it's mail, not a piece of moderatable state. It
 * IS stored, though — unlike a report, there was previously no way to reach
 * these at all once sent, since the inbox `CONTACT_EMAIL` points at isn't
 * something staff can log into.
 *
 * A conversation ("envelope") is one `ContactMessageDto` holding an ordered
 * thread of `ContactReplyEntryDto` entries — the original form submission is
 * itself the thread's first (inbound) entry, not a separate field, so every
 * message in a conversation (staff replies AND a visitor's own reply-email,
 * once Resend's inbound receiving is wired up) renders through the same
 * list rather than "the envelope's fields, then replies."
 */
export const ContactMessageRequest = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  email: Type.String({ format: 'email', maxLength: 254 }),
  subject: Type.String({ minLength: 1, maxLength: 200 }),
  message: Type.String({ minLength: 1, maxLength: 5000 }),
  /** Cloudflare Turnstile widget's response token, verified server-side before the message is stored/sent. */
  turnstileToken: Type.String({ minLength: 1, maxLength: 2048 }),
});
export type ContactMessageRequest = Static<typeof ContactMessageRequest>;

export const ContactMessageResponse = Type.Object({
  message: Type.String(),
});
export type ContactMessageResponse = Static<typeof ContactMessageResponse>;

export const ContactMessageStatus = {
  /** The last message in the thread is inbound — staff owes a reply. */
  NEW: 'new',
  /** The last message in the thread is outbound — staff has replied. */
  REPLIED: 'replied',
} as const;
export type ContactMessageStatus = (typeof ContactMessageStatus)[keyof typeof ContactMessageStatus];
export const CONTACT_MESSAGE_STATUSES = Object.values(ContactMessageStatus);

export const ContactMessageDirection = {
  /** From the visitor (a form submission, or a real inbound email once receiving is live). */
  INBOUND: 'inbound',
  /** From staff, sent via the admin panel. */
  OUTBOUND: 'outbound',
} as const;
export type ContactMessageDirection = (typeof ContactMessageDirection)[keyof typeof ContactMessageDirection];
export const CONTACT_MESSAGE_DIRECTIONS = Object.values(ContactMessageDirection);

/** One message in a conversation, in either direction. */
export const ContactReplyEntryDto = Type.Object({
  id: Uuid,
  direction: literalUnion(CONTACT_MESSAGE_DIRECTIONS),
  body: Type.String(),
  sentByUsername: Type.Union([Type.String(), Type.Null()]),
  fromAddress: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type ContactReplyEntryDto = Static<typeof ContactReplyEntryDto>;

/** A conversation as the staff inbox LIST shows it — envelope plus the latest message only. */
export const ContactMessageDto = Type.Object({
  id: Uuid,
  name: Type.String(),
  email: Type.String(),
  subject: Type.String(),
  status: literalUnion(CONTACT_MESSAGE_STATUSES),
  lastMessage: Type.String(),
  createdAt: IsoDateTime,
});
export type ContactMessageDto = Static<typeof ContactMessageDto>;

/** A conversation with its full, ordered thread — for the reply view. */
export const ContactMessageThreadDto = Type.Object({
  id: Uuid,
  name: Type.String(),
  email: Type.String(),
  subject: Type.String(),
  status: literalUnion(CONTACT_MESSAGE_STATUSES),
  createdAt: IsoDateTime,
  replies: Type.Array(ContactReplyEntryDto),
});
export type ContactMessageThreadDto = Static<typeof ContactMessageThreadDto>;

export const ContactReplyBody = Type.Object({
  replyText: Type.String({ minLength: 1, maxLength: 5000 }),
});
export type ContactReplyBody = Static<typeof ContactReplyBody>;
