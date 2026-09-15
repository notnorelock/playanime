import { MediaProviderId } from '@playanime/contracts';
import { createLinkOnlyProvider } from './factory.js';

/**
 * Providers recognized and normalized, but not embedded.
 *
 * Each carries a note naming exactly what must be established before it could
 * become an `EMBED` provider. None of them is a stub: URL parsing is real and
 * tested, because parsing is what deduplication, moderation and blocking rely
 * on. What is missing is verified permission to frame their content.
 */

const NOT_VERIFIED =
  'Supported embed mechanism not yet verified against the provider\'s published ' +
  'documentation and terms of service. Renders as an off-site link until it is.';

export const vidozaProvider = createLinkOnlyProvider({
  id: MediaProviderId.VIDOZA,
  label: 'Vidoza',
  hosts: ['vidoza.net', 'vidoza.co'],
  displayHost: 'vidoza.net',
  reliabilityWeight: 40,
  embedNote: NOT_VERIFIED,
  extractId: (url) => {
    // /{fileId}.html  ·  /embed-{fileId}.html
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    if (last === undefined) return null;

    const match = /^(?:embed-)?([A-Za-z0-9]{8,40})(?:\.html)?$/.exec(last);
    return match?.[1] ?? null;
  },
  canonicalize: (id) => `https://vidoza.net/${id}.html`,
});

export const mp4uploadProvider = createLinkOnlyProvider({
  id: MediaProviderId.MP4UPLOAD,
  label: 'MP4Upload',
  hosts: ['mp4upload.com'],
  displayHost: 'mp4upload.com',
  reliabilityWeight: 40,
  embedNote: NOT_VERIFIED,
  extractId: (url) => {
    // /{fileId}  ·  /embed-{fileId}.html
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    if (last === undefined) return null;

    const match = /^(?:embed-)?([A-Za-z0-9]{8,40})(?:\.html)?$/.exec(last);
    return match?.[1] ?? null;
  },
  canonicalize: (id) => `https://www.mp4upload.com/${id}`,
});

export const sibnetProvider = createLinkOnlyProvider({
  id: MediaProviderId.SIBNET,
  label: 'Sibnet',
  hosts: ['video.sibnet.ru', 'sibnet.ru'],
  displayHost: 'video.sibnet.ru',
  reliabilityWeight: 30,
  embedNote: NOT_VERIFIED,
  extractId: (url) => {
    // /video{id}-{slug}  ·  /shell.php?videoid={id}
    const queryId = url.searchParams.get('videoid');
    if (queryId !== null && /^\d{1,12}$/.test(queryId)) return queryId;

    const match = /\/video(\d{1,12})/.exec(url.pathname);
    return match?.[1] ?? null;
  },
  canonicalize: (id) => `https://video.sibnet.ru/video${id}`,
});

export { createLinkOnlyProvider } from './factory.js';
export type { LinkOnlyProviderSpec } from './factory.js';
