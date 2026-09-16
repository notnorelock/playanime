import { ApiError, NetworkError } from '@/api';
import { getErrorKey } from '@/utils/errorCodes';
import { useLocale } from './useLocale';

/**
 * Turns a rejected API call into copy a viewer can act on.
 *
 * The order matters: a mapped translation for the error's code is preferred, a
 * server message is the fallback, and a raw `Error.message` is used only when
 * nothing else exists. A `TypeError` from application code never reaches the
 * viewer — it becomes the generic failure message and stays in the console.
 */
export function useApiError() {
  const { t } = useLocale();

  function translateError(error: unknown): string {
    if (NetworkError.is(error)) return t('errors.network');

    if (ApiError.is(error)) {
      const key = getErrorKey(error.code);

      if (key !== null) {
        const translated = t(key);
        // `t` echoes the key back when it is missing; the server's own message
        // is better than showing a dotted path to the viewer.
        if (translated !== key) return translated;
      }

      return error.message;
    }

    return t('errors.unknown');
  }

  /** Field-keyed messages for a validation failure, empty for anything else. */
  function fieldErrors(error: unknown): Record<string, string> {
    return ApiError.is(error) ? error.fieldErrors : {};
  }

  return { translateError, fieldErrors };
}
