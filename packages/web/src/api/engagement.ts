import type {
  Comment,
  CommentCreateBody,
  CommentLikeResponse,
  CommentPage,
  CommentQuery,
  CommentUpdateBody,
  EpisodeRatingSummary,
  Rating,
  RatingUpsertBody,
  ReactionKind,
  ReviewCreateBody,
} from '@playanime/contracts';
import { http, type QueryParams } from './client';

/**
 * Ratings, comments and reviews.
 *
 * These endpoints key on the anime's **id**, not its slug — the route parameter
 * is named `:slug` server-side but validated as a uuid. Callers must pass
 * `anime.id`.
 */
export const engagementApi = {
  getRating: (animeId: string, signal?: AbortSignal): Promise<Rating | null> =>
    http.get<Rating | null>(
      `/anime/${encodeURIComponent(animeId)}/rating`,
      signal === undefined ? {} : { signal },
    ),

  saveRating: (animeId: string, body: RatingUpsertBody): Promise<Rating> =>
    http.put<Rating>(`/anime/${encodeURIComponent(animeId)}/rating`, { body }),

  removeRating: (animeId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/anime/${encodeURIComponent(animeId)}/rating`),

  comments: (animeId: string, query: CommentQuery = {}, signal?: AbortSignal): Promise<CommentPage> =>
    http.get<CommentPage>(`/anime/${encodeURIComponent(animeId)}/comments`, {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  createComment: (animeId: string, body: CommentCreateBody): Promise<Comment> =>
    http.post<Comment>(`/anime/${encodeURIComponent(animeId)}/comments`, { body }),

  reviews: (animeId: string, query: CommentQuery = {}, signal?: AbortSignal): Promise<CommentPage> =>
    http.get<CommentPage>(`/anime/${encodeURIComponent(animeId)}/reviews`, {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  createReview: (animeId: string, body: ReviewCreateBody): Promise<Comment> =>
    http.post<Comment>(`/anime/${encodeURIComponent(animeId)}/reviews`, { body }),

  updateComment: (commentId: string, body: CommentUpdateBody): Promise<Comment> =>
    http.patch<Comment>(`/comments/${encodeURIComponent(commentId)}`, { body }),

  deleteComment: (commentId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/comments/${encodeURIComponent(commentId)}`),

  /* ------------------------------------------------------------------ */
  /* Comment likes                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Likes or unlikes, returning the authoritative count.
   *
   * A toggle rather than a like/unlike pair: the server decides the resulting
   * state, so a repeated click cannot double-count and the UI never has to
   * guess the new total.
   */
  toggleLike: (commentId: string): Promise<CommentLikeResponse> =>
    http.post<CommentLikeResponse>(`/comments/${encodeURIComponent(commentId)}/like`),

  /* ------------------------------------------------------------------ */
  /* Episode engagement                                                  */
  /* ------------------------------------------------------------------ */

  episodeComments: (
    episodeId: string,
    query: CommentQuery = {},
    signal?: AbortSignal,
  ): Promise<CommentPage> =>
    http.get<CommentPage>(`/episodes/${encodeURIComponent(episodeId)}/comments`, {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  createEpisodeComment: (episodeId: string, body: CommentCreateBody): Promise<Comment> =>
    http.post<Comment>(`/episodes/${encodeURIComponent(episodeId)}/comments`, { body }),

  /** Aggregate, the viewer's own score and reaction tallies in one response. */
  episodeRating: (episodeId: string, signal?: AbortSignal): Promise<EpisodeRatingSummary> =>
    http.get<EpisodeRatingSummary>(
      `/episodes/${encodeURIComponent(episodeId)}/rating`,
      signal === undefined ? {} : { signal },
    ),

  /** Returns the refreshed summary, so no follow-up read is needed. */
  rateEpisode: (episodeId: string, body: RatingUpsertBody): Promise<EpisodeRatingSummary> =>
    http.put<EpisodeRatingSummary>(`/episodes/${encodeURIComponent(episodeId)}/rating`, { body }),

  removeEpisodeRating: (episodeId: string): Promise<EpisodeRatingSummary> =>
    http.delete<EpisodeRatingSummary>(`/episodes/${encodeURIComponent(episodeId)}/rating`),

  /** Reactions are tracked separately from the score. */
  toggleEpisodeReaction: (episodeId: string, kind: ReactionKind): Promise<EpisodeRatingSummary> =>
    http.post<EpisodeRatingSummary>(`/episodes/${encodeURIComponent(episodeId)}/reactions`, {
      body: { kind },
    }),
};
