import type { AniListPage } from './types.js';

/**
 * AniList's public GraphQL endpoint. No auth needed for reading public
 * media data.
 */
const ENDPOINT = 'https://graphql.anilist.co';

/**
 * One query, fetching everything the sync needs per title in one round
 * trip — title, genres, tags, studios, dates, format/status, artwork,
 * score. `Page(page, perPage)` is AniList's own pagination wrapper;
 * `perPage` is capped at 50 by AniList itself regardless of what's
 * requested.
 */
const QUERY = `
  query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
      }
      media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
        id
        idMal
        title {
          romaji
          english
          native
        }
        format
        status
        season
        seasonYear
        startDate {
          year
          month
          day
        }
        endDate {
          year
          month
          day
        }
        episodes
        duration
        isAdult
        description(asHtml: false)
        genres
        tags {
          name
          category
          rank
          isAdult
        }
        studios {
          edges {
            isMain
            node {
              name
            }
          }
        }
        coverImage {
          extraLarge
          large
        }
        bannerImage
        averageScore
        popularity
      }
    }
  }
`;

export interface AniListQueryVars {
  readonly page: number;
  readonly perPage: number;
  readonly season?: string | undefined;
  readonly seasonYear?: number | undefined;
}

interface RawStudioEdge {
  readonly isMain: boolean;
  readonly node: { readonly name: string };
}

interface RawMedia {
  readonly id: number;
  readonly idMal: number | null;
  readonly title: { readonly romaji: string | null; readonly english: string | null; readonly native: string | null };
  readonly format: string | null;
  readonly status: string | null;
  readonly season: string | null;
  readonly seasonYear: number | null;
  readonly startDate: { readonly year: number | null; readonly month: number | null; readonly day: number | null };
  readonly endDate: { readonly year: number | null; readonly month: number | null; readonly day: number | null };
  readonly episodes: number | null;
  readonly duration: number | null;
  readonly isAdult: boolean;
  readonly description: string | null;
  readonly genres: readonly string[];
  readonly tags: readonly { readonly name: string; readonly category: string | null; readonly rank: number | null; readonly isAdult: boolean }[];
  readonly studios: { readonly edges: readonly RawStudioEdge[] };
  readonly coverImage: { readonly extraLarge: string | null; readonly large: string | null } | null;
  readonly bannerImage: string | null;
  readonly averageScore: number | null;
  readonly popularity: number | null;
}

interface RawResponse {
  readonly data?: {
    readonly Page: {
      readonly pageInfo: { readonly hasNextPage: boolean };
      readonly media: readonly RawMedia[];
    };
  };
  readonly errors?: readonly { readonly message: string }[];
}

/**
 * How long to wait before retrying after AniList signals we've hit its
 * rate limit — read from the response headers rather than a fixed sleep,
 * since AniList has changed its own limit before (90 -> 30 req/min during
 * a documented 2024 incident) and a hardcoded delay would either be too
 * slow (wasting time) or too fast (getting rate-limited again) depending
 * on whatever the limit happens to be that day.
 */
async function waitForRateLimit(response: Response): Promise<void> {
  const retryAfter = response.headers.get('Retry-After');
  const seconds = retryAfter !== null ? Number(retryAfter) : 60;
  const delayMs = (Number.isFinite(seconds) ? seconds : 60) * 1000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** One page of AniList seasonal/popularity-sorted anime. Retries once on a 429. */
export async function fetchAniListPage(vars: AniListQueryVars): Promise<AniListPage> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: vars }),
    });

    if (response.status === 429) {
      await waitForRateLimit(response);
      continue;
    }

    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining !== null && Number(remaining) <= 1) {
      // Close to the limit — pause preemptively rather than waiting to be
      // told no, so a long run doesn't spend its time in 429 retries.
      await waitForRateLimit(response);
    }

    if (!response.ok) {
      throw new Error(`AniList request failed: ${String(response.status)} ${response.statusText}`);
    }

    const body = (await response.json()) as RawResponse;
    if (body.errors !== undefined && body.errors.length > 0) {
      throw new Error(`AniList GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (body.data === undefined) {
      throw new Error('AniList response had no data.');
    }

    return {
      hasNextPage: body.data.Page.pageInfo.hasNextPage,
      media: body.data.Page.media.map((m) => ({
        id: m.id,
        idMal: m.idMal,
        title: m.title,
        format: m.format,
        status: m.status,
        season: m.season,
        seasonYear: m.seasonYear,
        startDate: m.startDate,
        endDate: m.endDate,
        episodes: m.episodes,
        duration: m.duration,
        isAdult: m.isAdult,
        description: m.description,
        genres: m.genres,
        tags: m.tags,
        studios: m.studios.edges.map((edge) => ({ isMain: edge.isMain, name: edge.node.name })),
        coverImage: m.coverImage,
        bannerImage: m.bannerImage,
        averageScore: m.averageScore,
        popularity: m.popularity,
      })),
    };
  }

  throw new Error('AniList request failed after retrying once on a rate limit.');
}
