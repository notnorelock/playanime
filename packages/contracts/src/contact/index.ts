import { Type, type Static } from '@sinclair/typebox';

/**
 * Contact form.
 *
 * Deliberately separate from `reports` — a general inquiry ("can I advertise
 * with you", "I found a UI bug") has no moderation queue to enter and no
 * target row to attach to; it's an email, not a piece of moderatable state.
 */
export const ContactMessageRequest = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  email: Type.String({ format: 'email', maxLength: 254 }),
  subject: Type.String({ minLength: 1, maxLength: 200 }),
  message: Type.String({ minLength: 1, maxLength: 5000 }),
});
export type ContactMessageRequest = Static<typeof ContactMessageRequest>;

export const ContactMessageResponse = Type.Object({
  message: Type.String(),
});
export type ContactMessageResponse = Static<typeof ContactMessageResponse>;
