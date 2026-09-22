import { normalizeHost } from '../../validation/url.js';

/**
 * Byse host policy and URL construction.
 *
 * Byse is not a single-domain provider: it documents its API on
 * `api.byse.sx`, its source pages appear on rotating "byse"-branded domains
 * (`bysedikamoum.com` in the task's own examples), and the *embed* domain
 * itself can change — the documented `/get/domain` endpoint exists precisely
 * because Byse expects that to happen. So there are two separate questions
 * here, kept deliberately distinct:
 *
 * 1. **Which submitted URLs does Byse claim?** Answered by
 *    `isByseSourceHost`: any host whose registrable label starts with
 *    `byse`, per the task's instruction to "rely on all domains by byse
 *    prefixed 'byse'". This is intake-time recognition only.
 * 2. **Which URL may PlayAnime actually frame?** Answered by
 *    `ByseEmbedHostAllowlist`, which is deliberately *not* the same
 *    predicate. `/get/domain` can return a domain with no "byse" prefix at
 *    all (the docs' own example: `blablabla_embed_domain.com`), so a naming
 *    convention can never be the embed allowlist. Instead, the only hosts
 *    ever framed are the compiled-in documented default and whatever
 *    `ByseResolver` itself learned from that trusted, key-gated API call —
 *    never a bare guess derived from a submitted or stored URL.
 */

/** The documented default API base and embed host. */
export const BYSE_DEFAULT_API_BASE = 'https://api.byse.sx';
const BYSE_DEFAULT_EMBED_HOST = 'api.byse.sx';

/**
 * A "byse"-branded host: the label immediately left of the public suffix
 * starts with `byse` (`byse.sx`, `bysedikamoum.com`, `byse-cdn.example`).
 * Deliberately not a full PSL lookup — this project has no such dependency
 * elsewhere either (see `hostMatches`) — just enough structure that
 * `notbyse.com` or `mybyse.evil.com` (byse only as a subdomain label) do not
 * match while every real Byse mirror observed so far does.
 */
function registrableLabelStartsWithByse(hostname: string): boolean {
  const host = normalizeHost(hostname);
  const labels = host.split('.');
  // The registrable label is the second-to-last one for an ordinary
  // "label.tld" domain, and the only one for a bare single-label host.
  const registrable = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return registrable?.startsWith('byse') ?? false;
}

export function isByseSourceHost(hostname: string): boolean {
  return registrableLabelStartsWithByse(hostname);
}

/** `fileCode` tokens observed are short lowercase-alphanumeric slugs. */
const FILE_CODE = /^[a-z0-9]{6,32}$/i;

export function isByseFileCode(value: string): boolean {
  return FILE_CODE.test(value);
}

/**
 * The trusted embed-host allowlist.
 *
 * Starts with the documented default and grows only by `learn()`, called with
 * whatever `ByseResolver` itself got back from the key-gated `/get/domain`
 * call — never a value read off a submitted or stored URL. It is deliberately
 * append-only and holds no per-request state, so one shared instance is safe
 * under concurrent requests: two overlapping `resolvePlayback` calls can only
 * ever add to the set each other also benefits from, never see a host
 * "belonging" to a different in-flight request or race a removal.
 *
 * This is what lets `isEmbedUrlAllowed` be a synchronous, stateless-looking
 * check even though the actual embed domain is resolved asynchronously and
 * can change over the provider's lifetime.
 */
export class ByseEmbedHostAllowlist {
  private readonly hosts = new Set<string>([BYSE_DEFAULT_EMBED_HOST]);

  /** Records a domain `/get/domain` returned as now-trusted. Idempotent. */
  learn(domain: string): void {
    this.hosts.add(normalizeHost(domain));
  }

  isAllowed(hostname: string): boolean {
    return this.hosts.has(normalizeHost(hostname));
  }
}

/** Builds the documented embed player URL from a validated file code. */
export function buildByseEmbedUrl(fileCode: string, apiBase: string = BYSE_DEFAULT_API_BASE): string {
  if (!isByseFileCode(fileCode)) {
    throw new Error('Refusing to build a Byse embed URL from an invalid file code.');
  }
  const base = new URL(apiBase);
  return `${base.origin}/e/${encodeURIComponent(fileCode)}`;
}

/**
 * Builds the documented direct-download URL for the same file — same path
 * shape as the embed URL (`/e/<code>` -> `/download/<code>`), same base
 * resolution (the embed domain learned from `/get/domain`, falling back to
 * the documented default), so a download link always points at the same
 * host the embed itself is currently using.
 */
export function buildByseDownloadUrl(fileCode: string, apiBase: string = BYSE_DEFAULT_API_BASE): string {
  if (!isByseFileCode(fileCode)) {
    throw new Error('Refusing to build a Byse download URL from an invalid file code.');
  }
  const base = new URL(apiBase);
  return `${base.origin}/download/${encodeURIComponent(fileCode)}`;
}

/** The documented `/get/domain` endpoint. */
export function buildByseDomainLookupUrl(apiBase: string = BYSE_DEFAULT_API_BASE): string {
  return new URL('/get/domain', apiBase).toString();
}

/** The documented `/file/info` endpoint. */
export function buildByseFileInfoUrl(
  fileCode: string,
  apiBase: string = BYSE_DEFAULT_API_BASE,
): string {
  const url = new URL('/file/info', apiBase);
  url.searchParams.set('file_code', fileCode);
  return url.toString();
}

export const BYSE_EMBED_ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
