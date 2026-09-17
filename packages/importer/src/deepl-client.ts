/**
 * Thin wrapper over DeepL's free-tier REST API. Reads `DEEPL_API_KEY` from
 * the environment directly (not through `@playanime/config` — this key is
 * only ever used by this standalone import script, never by the running
 * API/web app, so it has no place in that shared runtime schema).
 *
 * DeepL's free endpoint is `api-free.deepl.com`; a paid key uses
 * `api.deepl.com` instead — distinguished by a `:fx` suffix on the key
 * itself, which is how DeepL's own SDKs pick the host.
 */

const FREE_KEY_SUFFIX = ':fx';

function endpointFor(apiKey: string): string {
  return apiKey.endsWith(FREE_KEY_SUFFIX)
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

interface RawDeepLResponse {
  readonly translations?: readonly { readonly text: string }[];
}

/**
 * DeepL accepts multiple `text` params in one call — batching every
 * not-yet-translated name into as few requests as possible (chunked at
 * 50, comfortably under DeepL's own per-request limits) rather than one
 * call per name.
 */
const BATCH_SIZE = 50;

/**
 * Translates English names to Polish, preserving order and length —
 * `names[i]` corresponds to the returned array's `[i]`. Throws on any
 * failure; the caller decides whether a translation failure should abort
 * the run or just skip setting `namePolish` for that batch (see sync.ts).
 */
export async function translateToPolish(apiKey: string, names: readonly string[]): Promise<string[]> {
  if (names.length === 0) return [];

  const endpoint = endpointFor(apiKey);
  const results: string[] = [];

  for (let start = 0; start < names.length; start += BATCH_SIZE) {
    const chunk = names.slice(start, start + BATCH_SIZE);

    const body = new URLSearchParams();
    body.append('source_lang', 'EN');
    body.append('target_lang', 'PL');
    for (const name of chunk) body.append('text', name);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`DeepL request failed: ${String(response.status)} ${response.statusText}`);
    }

    const parsed = (await response.json()) as RawDeepLResponse;
    const translations = parsed.translations ?? [];
    if (translations.length !== chunk.length) {
      throw new Error(
        `DeepL returned ${String(translations.length)} translations for ${String(chunk.length)} inputs — cannot map results back to names.`,
      );
    }

    for (const translation of translations) results.push(translation.text);
  }

  return results;
}
