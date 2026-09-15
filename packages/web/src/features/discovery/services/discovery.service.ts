import type { CalendarQuery, CalendarResponse, GenreListResponse } from '@playanime/contracts';
import { api } from '~/services/api-client.js';

export function listGenres(signal?: AbortSignal): Promise<GenreListResponse> {
  return api.get<GenreListResponse>('/genres', { signal });
}

export function getCalendar(
  query: CalendarQuery,
  signal?: AbortSignal,
): Promise<CalendarResponse> {
  return api.get<CalendarResponse>('/calendar', {
    query: { from: query.from, to: query.to },
    signal,
  });
}
