import { Elysia } from 'elysia';
import {
  AppError,
  NotFoundError,
  serializeError,
  toLoggableError,
  ValidationError,
} from '@playanime/shared';
import { createLogger, type Logger } from '@playanime/logger';
import { env, isProduction, shouldPrettyPrintLogs } from '@playanime/config';

/**
 * Error handling and request logging.
 *
 * Every error leaving the API passes through here, so the response shape is
 * uniform and no internal detail escapes. `serializeError` in
 * `@playanime/shared` decides what is safe to expose; this plugin decides what
 * gets logged and at which level.
 */

const config = env();

export const logger: Logger = createLogger({
  name: 'api',
  level: config.LOG_LEVEL,
  pretty: shouldPrettyPrintLogs(config),
});

/**
 * Maps Elysia's framework errors onto the platform error model.
 *
 * Elysia signals routing and validation failures through a `code` string rather
 * than by throwing an `AppError`. Without this translation every one of them
 * would be reported as an internal error — a missing route would look like a
 * server defect, and a validation failure would hide the fields at fault.
 *
 * An error that is ALREADY a real `AppError` (thrown by application code —
 * `ValidationError`, `NotFoundError`, etc. from `@playanime/shared`) must
 * never reach the translation below at all: this used to match those by
 * constructor name too ("since `code` is not always populated" on Elysia's
 * own internal errors), which meant a hand-thrown `ValidationError` with a
 * specific message and real per-field `issues` — e.g.
 * `submitSourceBatch`'s "every URL in this batch failed, here's why" — was
 * silently replaced with the generic "Nieprawidłowe dane żądania." and an
 * empty issues list, because `extractIssues` reads Elysia's own internal
 * `error.all` shape, which an application-thrown error never has. The
 * real cause was always in the log's response body reduced to a code and a
 * generic message, indistinguishable from an actual schema failure. Same
 * bug, same fix, for `NotFoundError`: a specific "Nie znaleziono tego
 * odcinka." became the generic "Nie znaleziono tego zasobu."
 */
function translateFrameworkError(code: string | number, error: unknown): unknown {
  if (AppError.is(error)) return error;

  // Elysia surfaces these as named error classes as well as a `code`; match on
  // the constructor name too, since `code` is not always populated. Reaching
  // here means `error` is NOT an AppError (checked above), so this can only
  // match Elysia's own internal error classes now, never an application one
  // that merely shares a class name.
  const name = error instanceof Error ? error.constructor.name : '';

  if (code === 'NOT_FOUND' || name === 'NotFoundError') {
    return new NotFoundError('Nie znaleziono tego zasobu.');
  }

  if (code === 'VALIDATION' || name === 'ValidationError') {
    return new ValidationError('Nieprawidłowe dane żądania.', extractIssues(error));
  }

  if (code === 'PARSE') {
    return new ValidationError('Nie udało się odczytać treści żądania.', [
      { path: 'body', message: 'Nieprawidłowy format treści żądania.' },
    ]);
  }

  return error;
}

/**
 * Pulls field-level issues out of an Elysia validation error.
 *
 * The detail lives in a `validator`/`errors` structure whose shape is not part
 * of Elysia's public contract, so every access is guarded and a failure to
 * parse degrades to an empty list rather than throwing inside the error
 * handler — which would replace a 422 with a 500.
 */
function extractIssues(error: unknown): { path: string; message: string }[] {
  if (typeof error !== 'object' || error === null) return [];

  const candidate = 'all' in error ? error.all : undefined;
  if (!Array.isArray(candidate)) return [];

  return candidate.flatMap((issue: unknown) => {
    if (typeof issue !== 'object' || issue === null) return [];

    const path = 'path' in issue && typeof issue.path === 'string' ? issue.path : '';
    const message =
      'message' in issue && typeof issue.message === 'string' ? issue.message : 'Nieprawidłowa wartość.';

    return [{ path: path.replace(/^\//, ''), message }];
  });
}

/** Correlates a client-visible error with its server log line. */
function requestId(request: Request): string {
  // Honour an upstream id so a trace spans the proxy and the API.
  const forwarded = request.headers.get('x-request-id');
  if (forwarded !== null && /^[A-Za-z0-9_-]{1,64}$/.test(forwarded)) return forwarded;
  return crypto.randomUUID();
}

export const errorHandler = new Elysia({ name: 'error-handler' })
  .derive({ as: 'global' }, ({ request }) => ({
    requestId: requestId(request),
    startedAt: performance.now(),
  }))
  .onError({ as: 'global' }, ({ error, set, code, requestId, request }) => {
    // Defaulted because Elysia types derived context as possibly-undefined; the
    // derive above always sets it, and a placeholder beats throwing inside the
    // error handler.
    const id = requestId ?? 'unknown';

    // Elysia's own routing and validation failures are not AppErrors, so they
    // would otherwise be flattened to a generic 500. Translate them into the
    // platform error model first, so an unknown path returns 404 and a bad body
    // returns 422 with the offending fields.
    const normalized = translateFrameworkError(code, error);

    const { status, body } = serializeError(normalized, { requestId: id });
    set.status = status;

    const context = {
      requestId: id,
      route: new URL(request.url).pathname,
      method: request.method,
      status,
    };

    // 5xx is a defect and gets a stack; 4xx is the client's problem and gets a
    // single line, so ordinary validation noise does not bury real failures.
    if (status >= 500) {
      logger.error('Request failed', toLoggableError(error), context);
    } else if (AppError.is(normalized)) {
      logger.debug(`Request rejected: ${normalized.code}`, context);
    } else {
      logger.warn('Unrecognized error shape', context);
    }

    // Retry-After is part of the rate-limit contract, not just advisory.
    if (status === 429 && AppError.is(normalized) && 'retryAfterSeconds' in normalized) {
      set.headers['retry-after'] = String(normalized.retryAfterSeconds);
    }

    return body;
  })
  .onAfterResponse({ as: 'global' }, ({ request, set, requestId, startedAt }) => {
    const id = requestId ?? 'unknown';
    const durationMs = Math.round(performance.now() - (startedAt ?? performance.now()));
    const path = new URL(request.url).pathname;

    // Health probes run constantly; logging them at info drowns everything else.
    if (path.startsWith('/api/v1/health') || path === '/api/v1/live') {
      logger.trace('Probe', { requestId: id, route: path, durationMs });
      return;
    }

    logger.info('Request completed', {
      requestId: id,
      method: request.method,
      route: path,
      status: typeof set.status === 'number' ? set.status : 200,
      durationMs,
    });
  });

/** True when stack traces must never reach a response body. */
export const hideInternals = isProduction(config.NODE_ENV);
