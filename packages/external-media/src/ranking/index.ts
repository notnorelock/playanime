import { AvailabilityStatus, type SourceLanguage, type QualityHint } from '@playanime/contracts';
import type { ProviderRegistry } from '../registry/registry.js';

/**
 * Source ordering.
 *
 * Ranking lives on the server so the preferred provider order is a
 * configuration decision, not a constant compiled into the frontend. Changing
 * which provider viewers get first must not require a web deploy.
 */

export interface RankableSource {
  readonly id: string;
  readonly provider: string;
  readonly isVerified: boolean;
  readonly availability: AvailabilityStatus;
  readonly audioLanguage: SourceLanguage | null;
  readonly subtitleLanguage: SourceLanguage | null;
  readonly qualityHint: QualityHint | null;
  /** Manual moderator override. Higher wins. */
  readonly priority: number;
  readonly failureCount: number;
}

/**
 * Tunable weights.
 *
 * Exposed as data so a deployment can re-tune ordering without a code change —
 * the values below are defaults, not law.
 */
export interface RankingWeights {
  readonly verified: number;
  readonly available: number;
  readonly unavailablePenalty: number;
  readonly audioLanguageMatch: number;
  readonly subtitleLanguageMatch: number;
  readonly providerReliability: number;
  readonly priorityMultiplier: number;
  readonly failurePenalty: number;
  readonly qualityMultiplier: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  verified: 500,
  available: 300,
  unavailablePenalty: -1000,
  audioLanguageMatch: 250,
  subtitleLanguageMatch: 200,
  providerReliability: 1,
  priorityMultiplier: 100,
  failurePenalty: -25,
  qualityMultiplier: 10,
};

/** Quality ordering. `unknown` scores zero rather than guessing. */
const QUALITY_SCORE: Readonly<Record<string, number>> = {
  '2160p': 5,
  '1440p': 4,
  '1080p': 3,
  '720p': 2,
  sd: 1,
  unknown: 0,
};

export interface ViewerPreferences {
  readonly preferredAudioLanguage: SourceLanguage | null;
  readonly preferredSubtitleLanguage: SourceLanguage | null;
}

export function scoreSource(
  source: RankableSource,
  preferences: ViewerPreferences,
  registry: ProviderRegistry,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): number {
  let score = 0;

  if (source.isVerified) score += weights.verified;

  if (source.availability === AvailabilityStatus.AVAILABLE) score += weights.available;
  else if (source.availability === AvailabilityStatus.UNAVAILABLE) score += weights.unavailablePenalty;

  if (
    preferences.preferredAudioLanguage !== null &&
    source.audioLanguage === preferences.preferredAudioLanguage
  ) {
    score += weights.audioLanguageMatch;
  }

  if (
    preferences.preferredSubtitleLanguage !== null &&
    source.subtitleLanguage === preferences.preferredSubtitleLanguage
  ) {
    score += weights.subtitleLanguageMatch;
  }

  // An unregistered provider contributes nothing rather than throwing: ranking
  // must not fail a listing request because the allowlist changed.
  const reliability = registry.has(source.provider as never)
    ? registry.get(source.provider as never).definition.reliabilityWeight
    : 0;
  score += reliability * weights.providerReliability;

  score += source.priority * weights.priorityMultiplier;
  score += source.failureCount * weights.failurePenalty;
  score += (QUALITY_SCORE[source.qualityHint ?? 'unknown'] ?? 0) * weights.qualityMultiplier;

  return score;
}

/** Sorts descending by score. Ties break on id for a stable order across requests. */
export function rankSources<T extends RankableSource>(
  sources: readonly T[],
  preferences: ViewerPreferences,
  registry: ProviderRegistry,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): readonly T[] {
  return [...sources]
    .map((source) => ({ source, score: scoreSource(source, preferences, registry, weights) }))
    .sort((a, b) => (b.score - a.score) || a.source.id.localeCompare(b.source.id))
    .map((entry) => entry.source);
}
