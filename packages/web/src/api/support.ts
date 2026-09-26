import type {
  SupportTicketCreateBody,
  SupportTicketPage,
  SupportTicketStatus,
  SupportTicketThreadDto,
} from '@playanime/contracts'
import { http } from './client'

/** Support tickets — a logged-in user's own help requests, replied to by staff from the admin panel. */
export const supportApi = {
  submit: (body: SupportTicketCreateBody): Promise<{ id: string }> =>
    http.post<{ id: string }>('/support/tickets', { body }),

  /** The caller's own tickets, newest first. */
  mine: (cursor?: string, limit = 20, signal?: AbortSignal): Promise<SupportTicketPage> =>
    http.get<SupportTicketPage>('/support/tickets/mine', {
      query: { limit, ...(cursor === undefined ? {} : { cursor }) },
      ...(signal === undefined ? {} : { signal })
    }),

  /** One of the caller's own tickets, with its full thread. */
  mineThread: (id: string, signal?: AbortSignal): Promise<SupportTicketThreadDto> =>
    http.get<SupportTicketThreadDto>(`/support/tickets/mine/${encodeURIComponent(id)}`, signal === undefined ? {} : { signal }),

  /** Reply to one of the caller's own tickets — reopens it. Rejected once closed. */
  replyMine: (id: string, message: string): Promise<{ id: string; status: SupportTicketStatus }> =>
    http.post<{ id: string; status: SupportTicketStatus }>(`/support/tickets/mine/${encodeURIComponent(id)}/reply`, { body: { message } }),

  /** Staff-only: the ticket queue. */
  list: (
    status?: SupportTicketStatus,
    cursor?: string,
    limit = 20,
    signal?: AbortSignal
  ): Promise<SupportTicketPage> =>
    http.get<SupportTicketPage>('/support/tickets', {
      query: { limit, ...(status === undefined ? {} : { status }), ...(cursor === undefined ? {} : { cursor }) },
      ...(signal === undefined ? {} : { signal })
    }),

  /** Staff-only: one ticket, with its full thread. */
  thread: (id: string, signal?: AbortSignal): Promise<SupportTicketThreadDto> =>
    http.get<SupportTicketThreadDto>(`/support/tickets/${encodeURIComponent(id)}`, signal === undefined ? {} : { signal }),

  reply: (id: string, message: string): Promise<{ id: string; status: SupportTicketStatus }> =>
    http.post<{ id: string; status: SupportTicketStatus }>(`/support/tickets/${encodeURIComponent(id)}/reply`, { body: { message } }),

  close: (id: string): Promise<{ id: string; status: SupportTicketStatus }> =>
    http.post<{ id: string; status: SupportTicketStatus }>(`/support/tickets/${encodeURIComponent(id)}/close`, {})
}
