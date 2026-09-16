import type { ProfileRepository } from '@playanime/database';

type ProfileRow = NonNullable<Awaited<ReturnType<ProfileRepository['findByUsername']>>>;
type PreferencesRow = NonNullable<Awaited<ReturnType<ProfileRepository['preferences']>>>;

export function toPublicProfile(row: ProfileRow) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export function toProfileSettings(row: {
  displayName: string | null;
  bio: string | null;
  pronouns: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  updatedAt: Date;
}) {
  return {
    displayName: row.displayName,
    bio: row.bio,
    pronouns: row.pronouns,
    avatar: row.avatarUrl,
    banner: row.bannerUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPreferences(row: PreferencesRow) {
  return {
    locale: row.locale,
    preferredAudioLanguage: row.preferredAudioLanguage,
    preferredSubtitleLanguage: row.preferredSubtitleLanguage,
    showMatureContent: row.showMatureContent,
    autoplayNextEpisode: row.autoplayNextEpisode,
    skipIntroAutomatically: row.skipIntroAutomatically,
    emailNotifications: row.emailNotifications,
    updatedAt: row.updatedAt.toISOString(),
  };
}
