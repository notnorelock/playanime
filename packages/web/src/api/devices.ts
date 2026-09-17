import type { DeviceListResponse, DeviceSummary, SecurityEventPage } from '@playanime/contracts';
import { http } from './client';

export const devicesApi = {
  list: (): Promise<DeviceListResponse> => http.get<DeviceListResponse>('/auth/devices'),

  rename: (id: string, displayName: string): Promise<DeviceSummary> =>
    http.patch<DeviceSummary>(`/auth/devices/${encodeURIComponent(id)}`, { body: { displayName } }),

  block: (id: string, reason?: string): Promise<DeviceSummary> =>
    http.post<DeviceSummary>(`/auth/devices/${encodeURIComponent(id)}/block`, {
      body: reason === undefined ? {} : { reason },
    }),

  unblock: (id: string): Promise<DeviceSummary> =>
    http.post<DeviceSummary>(`/auth/devices/${encodeURIComponent(id)}/unblock`),

  securityEvents: (cursor?: string, signal?: AbortSignal): Promise<SecurityEventPage> =>
    http.get<SecurityEventPage>('/auth/security-events', {
      query: cursor === undefined ? {} : { cursor },
      ...(signal === undefined ? {} : { signal }),
    }),
};
