import { Type, type Static } from '@sinclair/typebox';
import { SOURCE_LANGUAGES } from '../media/sources.js';
import { IsoDateTime, literalUnion } from '../common/index.js';

const OptionalLanguage = Type.Union([literalUnion(SOURCE_LANGUAGES), Type.Null()]);

export const UserPreferences = Type.Object({
  locale: Type.String({ minLength: 2, maxLength: 10 }),
  preferredAudioLanguage: OptionalLanguage,
  preferredSubtitleLanguage: OptionalLanguage,
  showMatureContent: Type.Boolean(),
  autoplayNextEpisode: Type.Boolean(),
  skipIntroAutomatically: Type.Boolean(),
  emailNotifications: Type.Boolean(),
  updatedAt: IsoDateTime,
});
export type UserPreferences = Static<typeof UserPreferences>;

export const PreferencesUpdateBody = Type.Partial(
  Type.Object({
    locale: Type.String({ minLength: 2, maxLength: 10 }),
    preferredAudioLanguage: OptionalLanguage,
    preferredSubtitleLanguage: OptionalLanguage,
    showMatureContent: Type.Boolean(),
    autoplayNextEpisode: Type.Boolean(),
    skipIntroAutomatically: Type.Boolean(),
    emailNotifications: Type.Boolean(),
  }),
);
export type PreferencesUpdateBody = Static<typeof PreferencesUpdateBody>;
