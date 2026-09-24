import type { SitePageDto, SitePageSlug, SitePageUpdateBody } from '@playanime/contracts';
import { http } from './client';

/** Admin-editable static content pages (VIP today). Public read, admin-only write. */
export const pagesApi = {
  get: (slug: SitePageSlug, signal?: AbortSignal): Promise<SitePageDto> =>
    http.get<SitePageDto>(`/pages/${slug}`, signal === undefined ? {} : { signal }),

  update: (slug: SitePageSlug, body: SitePageUpdateBody): Promise<SitePageDto> =>
    http.patch<SitePageDto>(`/pages/${slug}`, { body }),
};
