import type { AniListMedia, AniListPage } from './types.js';

/**
 * AniList's public GraphQL endpoint. No auth needed for reading public
 * media data.
 */
const ENDPOINT = 'https://graphql.anilist.co';

/**
 * The exact `media { ... }` field selection every query in this file
 * needs — title, genres, tags, studios, dates, format/status, artwork,
 * score. Shared as one string fragment so the three queries below (page
 * listing, search, single-id lookup) can never drift out of sync with
 * each other on what fields they request.
 */
const MEDIA_FIELDS = `
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
`;

/**
 * One query, fetching everything the sync needs per title in one round
 * trip. `Page(page, perPage)` is AniList's own pagination wrapper;
 * `perPage` is capped at 50 by AniList itself regardless of what's
 * requested.
 */
const PAGE_QUERY = `
  query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
      }
      media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

/**
 * Free-text title search, for the "add anime" form's live autocomplete —
 * AniList ranks its own search results by relevance, so no explicit
 * `sort:` is passed here (unlike PAGE_QUERY's POPULARITY_DESC, which
 * exists because that query has no search term to rank against).
 */
const SEARCH_QUERY = `
  query ($search: String, $perPage: Int) {
    Page(perPage: $perPage) {
      media(type: ANIME, search: $search) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

/**
 * A single title by its AniList id — used once an author picks a search
 * result, to fetch the full field set for autofill (the search query
 * above already returns every field too, but re-fetching by id keeps the
 * two concerns — "what did the search look like" vs. "what should
 * autofill the form" — decoupled, and avoids the frontend needing to
 * cache/pass the full search-result payload back to the server).
 */
const BY_ID_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS}
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

/** Converts one raw GraphQL media object into this package's own `AniListMedia` shape. */
function mapRawMedia(m: RawMedia): AniListMedia {
  return {
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
  };
}

interface RawPageResponse {
  readonly data?: {
    readonly Page: {
      readonly pageInfo: { readonly hasNextPage: boolean };
      readonly media: readonly RawMedia[];
    };
  };
  readonly errors?: readonly { readonly message: string }[];
}

interface RawByIdResponse {
  readonly data?: { readonly Media: RawMedia | null };
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

/**
 * POSTs one GraphQL query, retrying once on a 429 and backing off
 * preemptively when the remaining-request header is nearly exhausted.
 * Shared by every query in this file so the rate-limit handling lives in
 * exactly one place.
 *
 * `allow404` exists specifically for `Media(id: ...)`: AniList answers a
 * request for a nonexistent id with HTTP 404 — confirmed directly against
 * the live API — but the body is still a normal, parseable GraphQL
 * response (`{"data":{"Media":null},"errors":[{"message":"Not Found."}]}`),
 * not a broken one. Treating every non-ok status as fatal (the default)
 * is correct for the page/search queries, where a 404 would be a genuine
 * transport failure, but wrong for a by-id lookup, where "not found" is
 * an expected, valid outcome the caller needs to see as `data: { Media:
 * null }`, not an exception.
 */
async function postGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  options: { allow404?: boolean } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
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

    const isAcceptable404 = response.status === 404 && options.allow404 === true;
    if (!response.ok && !isAcceptable404) {
      throw new Error(`AniList request failed: ${String(response.status)} ${response.statusText}`);
    }

    const body = (await response.json()) as { data?: T; errors?: readonly { message: string }[] };
    if (body.data === undefined) {
      if (isAcceptable404) {
        throw new Error('AniList 404 response had no data — expected {"data":{"Media":null}}.');
      }
      const errorDetail = body.errors?.map((e) => e.message).join('; ') ?? 'no data';
      throw new Error(`AniList GraphQL error: ${errorDetail}`);
    }

    return body.data;
  }

  throw new Error('AniList request failed after retrying once on a rate limit.');
}

/** One page of AniList seasonal/popularity-sorted anime. Retries once on a 429. */
export async function fetchAniListPage(vars: AniListQueryVars): Promise<AniListPage> {
  const data = await postGraphQL<RawPageResponse['data'] & object>(PAGE_QUERY, { ...vars });
  return {
    hasNextPage: data.Page.pageInfo.hasNextPage,
    media: data.Page.media.map(mapRawMedia),
  };
}

/**
 * Free-text title search, for the "add anime" form's live autocomplete.
 * `perPage` defaults to 8 — enough to show a short picker list without
 * over-fetching on every keystroke.
 */
export async function searchAniList(query: string, perPage = 8): Promise<AniListMedia[]> {
  const data = await postGraphQL<RawPageResponse['data'] & object>(SEARCH_QUERY, { search: query, perPage });
  return data.Page.media.map(mapRawMedia);
}

/** A single title by its AniList id, for autofilling the create-anime form. Null if AniList has no such id. */
export async function fetchAniListById(id: number): Promise<AniListMedia | null> {
  const data = await postGraphQL<RawByIdResponse['data'] & object>(BY_ID_QUERY, { id }, { allow404: true });
  return data.Media === null ? null : mapRawMedia(data.Media);
}
