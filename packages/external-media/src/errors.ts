import { AppError, ErrorCode, ValidationError, type AppErrorOptions } from '@playanime/shared';

/**
 * Typed failures from external-media resolution.
 *
 * Messages are client-safe. Causes stay on `cause` and are logged, never sent.
 */

export class ExternalMediaInvalidUrlError extends ValidationError {
  constructor(message = 'This media URL is not valid.', options: AppErrorOptions = {}) {
    super(message, [{ path: 'url', message }], {
      code: ErrorCode.MEDIA_INVALID_URL,
      ...options,
    });
  }
}

export class ExternalMediaUnavailableError extends AppError {
  constructor(
    message = 'This playback source is currently unavailable.',
    options: AppErrorOptions = {},
  ) {
    super(message, {
      code: ErrorCode.MEDIA_SOURCE_UNAVAILABLE,
      status: 404,
      expose: true,
      ...options,
    });
  }
}

export class ExternalMediaAccessDeniedError extends AppError {
  constructor(
    message = 'This playback source is not accessible.',
    options: AppErrorOptions = {},
  ) {
    super(message, {
      code: ErrorCode.MEDIA_ACCESS_DENIED,
      status: 403,
      expose: true,
      ...options,
    });
  }
}

export class ExternalMediaResolutionError extends AppError {
  constructor(
    message = 'Playback information could not be resolved.',
    options: AppErrorOptions = {},
  ) {
    super(message, {
      code: ErrorCode.MEDIA_RESOLUTION_FAILED,
      status: 502,
      expose: true,
      ...options,
    });
  }
}

export class ExternalMediaUnsupportedProviderError extends AppError {
  constructor(
    message = 'This media provider is not supported.',
    options: AppErrorOptions = {},
  ) {
    super(message, {
      code: ErrorCode.MEDIA_UNSUPPORTED_PROVIDER,
      status: 422,
      expose: true,
      ...options,
    });
  }
}
