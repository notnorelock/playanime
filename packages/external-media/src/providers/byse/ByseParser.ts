import type { ByseSource } from './ByseTypes.js';
import { buildByseEmbedUrl, isByseFileCode, isByseSourceHost } from './ByseUrls.js';

/**
 * Byse URL parsing, kept separate from network access and descriptor
 * construction — the same split as every other provider here.
 *
 * Both documented shapes carry the same identity, the file code:
 *
 *   https://bysedikamoum.com/e/xch2ympylj8c
 *   https://bysedikamoum.com/download/xch2ympylj8c/solo-leveling-01
 *
 * The `/download/` slug is display-only provenance from whoever shared the
 * link; it is never part of identity and is dropped during normalization, so
 * `/download/xch2ympylj8c/solo-leveling-01` and a later
 * `/download/xch2ympylj8c/some-other-title` still dedupe to one source.
 */
export function parseByseUrl(url: URL): string | null {
  if (!isByseSourceHost(url.hostname)) return null;

  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const [section, code] = segments;
  if (section === undefined || code === undefined) return null;

  if (section !== 'e' && section !== 'download') return null;
  if (!isByseFileCode(code)) return null;

  return code;
}

/** Builds the stored identity for a resolved file code. */
export function toByseSource(fileCode: string): ByseSource {
  return {
    provider: 'byse',
    fileCode,
    canonicalUrl: buildByseEmbedUrl(fileCode),
  };
}
