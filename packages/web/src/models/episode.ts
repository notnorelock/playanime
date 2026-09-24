import type { EpisodeCreditDto, EpisodeCreditRole, EpisodeProgress, EpisodeSummary } from '@playanime/contracts';

/**
 * Episode presentation model.
 *
 * Progress is carried alongside the episode rather than fetched per card: the
 * watch bootstrap and the continue-watching rail both return it with the
 * episode, so a card never needs a request of its own.
 */
export interface EpisodeCardModel {
  readonly id: string;
  readonly entryId: string;
  readonly number: number;
  readonly title: string;
  readonly synopsis: string | null;
  readonly durationSeconds: number | null;
  readonly airedAt: string | null;
  readonly isFiller: boolean;
  readonly isRecap: boolean;
  /** 0-100, or null when the viewer has not started this episode. */
  readonly progressPercent: number | null;
  readonly isCompleted: boolean;
  readonly introStartSeconds: number | null;
  readonly introEndSeconds: number | null;
  /** True when this viewer needs an active VIP grant to actually watch this episode — see `EpisodeSummary.requiresVip`'s own doc comment. Metadata above is still real either way; only playback is gated. */
  readonly requiresVip: boolean;
}

/** Percentage watched, or null when it cannot be computed honestly. */
export function progressPercent(
  positionSeconds: number,
  durationSeconds: number | null,
): number | null {
  if (durationSeconds === null || durationSeconds <= 0) return null;
  return Math.min(100, Math.max(0, (positionSeconds / durationSeconds) * 100));
}

export function toEpisodeCardModel(
  episode: EpisodeSummary,
  locale = 'pl',
  progress: EpisodeProgress | null = episode.progress,
): EpisodeCardModel {
  // Every episode needs a label; a numbered fallback beats an empty heading.
  const numberedFallback = `${locale.startsWith('pl') ? 'Odcinek' : 'Episode'} ${String(episode.number)}`

  return {
    id: episode.id,
    entryId: episode.entryId,
    number: episode.number,
    title: episode.title ?? numberedFallback,
    synopsis: episode.synopsis,
    durationSeconds: episode.durationSeconds,
    airedAt: episode.airedAt,
    isFiller: episode.isFiller,
    isRecap: episode.isRecap,
    progressPercent:
      progress === null
        ? null
        : progressPercent(progress.positionSeconds, progress.durationSeconds ?? episode.durationSeconds),
    isCompleted: progress?.isCompleted ?? false,
    introStartSeconds: episode.introStartSeconds,
    introEndSeconds: episode.introEndSeconds,
    requiresVip: episode.requiresVip,
  };
}

/**
 * One credit block: its group name plus who did what, only the roles it
 * actually has someone in. `groupId`/`groupSlug` null means a PlayAnime
 * staff credit with no group attribution — the panel still shows a
 * "Grupa:" line for it, labelled as the staff team, just with no link.
 */
export interface EpisodeCreditGroupModel {
  readonly groupId: string | null;
  readonly groupName: string;
  readonly groupSlug: string | null;
  /** Only roles with at least one credited person — the display never shows an empty "QC:" line. */
  readonly roles: readonly { role: EpisodeCreditRole; names: readonly string[] }[];
}

const CREDIT_ROLE_ORDER: readonly EpisodeCreditRole[] = ['translation', 'correction', 'qc', 'typesetting'];

/** Every null-group credit collapses into one "PlayAnime staff" block, keyed separately from any real group id. */
const STAFF_BUCKET_KEY = '__staff__';

/**
 * Groups a flat credit list by group, then by role, dropping any role with no
 * one credited — the watch page renders "Tłumaczenie: ..." only for roles
 * that are actually populated, never a blank field.
 */
export function groupEpisodeCredits(
  credits: readonly EpisodeCreditDto[],
  staffLabel = 'PlayAnime',
): EpisodeCreditGroupModel[] {
  const byGroup = new Map<
    string,
    { groupId: string | null; groupName: string; groupSlug: string | null; byRole: Map<EpisodeCreditRole, string[]> }
  >();

  for (const credit of credits) {
    const key = credit.groupId ?? STAFF_BUCKET_KEY;
    let group = byGroup.get(key);
    if (group === undefined) {
      group = {
        groupId: credit.groupId,
        groupName: credit.groupName ?? staffLabel,
        groupSlug: credit.groupSlug,
        byRole: new Map(),
      };
      byGroup.set(key, group);
    }
    const name = credit.displayName ?? credit.username;
    const names = group.byRole.get(credit.role);
    if (names === undefined) group.byRole.set(credit.role, [name]);
    else names.push(name);
  }

  return [...byGroup.values()].map((group) => ({
    groupId: group.groupId,
    groupName: group.groupName,
    groupSlug: group.groupSlug,
    roles: CREDIT_ROLE_ORDER.filter((role) => group.byRole.has(role)).map((role) => ({
      role,
      names: group.byRole.get(role) ?? [],
    })),
  }));
}
