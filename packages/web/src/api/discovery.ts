import type { CalendarQuery, CalendarResponse, HealthReport } from '@playanime/contracts';
import { http, type QueryParams } from './client';

export const discoveryApi = {
  calendar: (query: CalendarQuery, signal?: AbortSignal): Promise<CalendarResponse> =>
    http.get<CalendarResponse>('/calendar', {
      query: query as unknown as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  health: (signal?: AbortSignal): Promise<HealthReport> =>
    http.get<HealthReport>('/health', signal === undefined ? {} : { signal }),
};
