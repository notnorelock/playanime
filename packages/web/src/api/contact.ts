import type { ContactMessageRequest, ContactMessageResponse } from '@playanime/contracts';
import { http } from './client';

export const contactApi = {
  send: (body: ContactMessageRequest): Promise<ContactMessageResponse> =>
    http.post<ContactMessageResponse>('/contact', { body }),
};
