import type { MySanction } from '@playanime/contracts';
import type { AdminRepository, ProfileRepository } from '@playanime/database';

type ProfileRow = NonNullable<Awaited<ReturnType<ProfileRepository['findByUsername']>>>;
type PreferencesRow = NonNullable<Awaited<ReturnType<ProfileRepository['preferences']>>>;
type SanctionRow = Awaited<ReturnType<AdminRepository['sanctions']>>[number];

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

export function toMySanction(row: SanctionRow): MySanction {
  const isActive = row.liftedAt === null && (row.expiresAt === null || row.expiresAt.getTime() > Date.now());
  return {
    id: row.id,
    kind: row.kind,
    reason: row.reason,
    issuedAt: row.createdAt.toISOString(),
    issuedByUsername: row.issuedByUsername,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    isActive,
    liftedAt: row.liftedAt?.toISOString() ?? null,
    liftedByUsername: row.liftedByUsername,
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
