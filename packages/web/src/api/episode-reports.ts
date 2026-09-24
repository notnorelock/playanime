import type {
  EpisodeReportCreateBody,
  EpisodeReportCreateResponse,
  EpisodeReportDto,
  EpisodeReportResolveBody,
  EpisodeReportStatus,
} from '@playanime/contracts'
import { http } from './client'

/** "Report episode" — see `packages/contracts/src/episode-reports/index.ts` for the design rationale. */
export const episodeReportsApi = {
  submit: (body: EpisodeReportCreateBody): Promise<EpisodeReportCreateResponse> =>
    http.post<EpisodeReportCreateResponse>('/episode-reports', { body }),

  /** Staff-only: the report queue. */
  list: (status?: EpisodeReportStatus, limit = 50, signal?: AbortSignal): Promise<EpisodeReportDto[]> =>
    http.get<EpisodeReportDto[]>('/episode-reports', {
      query: { limit, ...(status === undefined ? {} : { status }) },
      ...(signal === undefined ? {} : { signal })
    }),

  resolve: (id: string, body: EpisodeReportResolveBody, asGroupId?: string): Promise<EpisodeReportDto> =>
    http.post<EpisodeReportDto>(`/episode-reports/${encodeURIComponent(id)}/resolve`, {
      body,
      ...(asGroupId === undefined ? {} : { query: { groupId: asGroupId } })
    }),

  /** A group leader's own queue — only reports for episodes their group is credited on. */
  forGroup: (groupId: string, limit = 50, signal?: AbortSignal): Promise<EpisodeReportDto[]> =>
    http.get<EpisodeReportDto[]>(`/episode-reports/groups/${encodeURIComponent(groupId)}`, {
      query: { limit },
      ...(signal === undefined ? {} : { signal })
    })
}
