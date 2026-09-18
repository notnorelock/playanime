import type { ReportSubmissionRequest, ReportSubmissionResponse } from '@playanime/contracts';
import { http } from './client';

/**
 * Content reporting.
 *
 * Open to anonymous callers — no auth required, matching the backend's own
 * deliberate design (a rights holder is usually not a registered user).
 */
export const reportsApi = {
  submit: (body: ReportSubmissionRequest): Promise<ReportSubmissionResponse> =>
    http.post<ReportSubmissionResponse>('/reports', { body }),
};
