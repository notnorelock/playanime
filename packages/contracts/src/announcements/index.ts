import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Uuid } from '../common/index.js';

/**
 * The homepage announcement strip.
 *
 * One active announcement at a time, admin-editable — see the schema's own
 * doc comment (`packages/database/src/schema/announcements.ts`) for why
 * this is a small history table rather than one mutable row.
 */

/** What the public homepage reads — null when nothing is currently active, not an empty object. */
export const ActiveAnnouncementDto = Type.Union([
  Type.Object({
    id: Uuid,
    message: Type.String(),
    linkUrl: Type.Union([Type.String(), Type.Null()]),
    linkLabel: Type.Union([Type.String(), Type.Null()]),
    createdAt: IsoDateTime,
  }),
  Type.Null(),
]);
export type ActiveAnnouncementDto = Static<typeof ActiveAnnouncementDto>;

/** An announcement as the admin history list shows it — includes who set it and its active/replaced state, neither of which the public DTO exposes. */
export const AnnouncementDto = Type.Object({
  id: Uuid,
  message: Type.String(),
  linkUrl: Type.Union([Type.String(), Type.Null()]),
  linkLabel: Type.Union([Type.String(), Type.Null()]),
  isActive: Type.Boolean(),
  createdByUsername: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDateTime,
});
export type AnnouncementDto = Static<typeof AnnouncementDto>;

export const AnnouncementSetBody = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 500 }),
  linkUrl: Type.Optional(Type.Union([Type.String({ maxLength: 2048 }), Type.Null()])),
  linkLabel: Type.Optional(Type.Union([Type.String({ maxLength: 100 }), Type.Null()])),
});
export type AnnouncementSetBody = Static<typeof AnnouncementSetBody>;
