import type { CalendarQuery, CalendarResponse, HealthReport, RankingPeriod, RankingResponse } from '@playanime/contracts';
import { http, type QueryParams } from './client';

export const discoveryApi = {
  calendar: (query: CalendarQuery, signal?: AbortSignal): Promise<CalendarResponse> =>
    http.get<CalendarResponse>('/calendar', {
      query: query as unknown as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  health: (signal?: AbortSignal): Promise<HealthReport> =>
    http.get<HealthReport>('/health', signal === undefined ? {} : { signal }),

  /** Time-windowed popularity ranking — week/month/year/all-time, ranked by distinct viewers. */
  ranking: (period: RankingPeriod, limit = 10, signal?: AbortSignal): Promise<RankingResponse> =>
    http.get<RankingResponse>('/ranking', {
      query: { period, limit },
      ...(signal === undefined ? {} : { signal }),
    }),
};
