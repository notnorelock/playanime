import { describe, expect, it } from 'bun:test';
import {
  AppError,
  ErrorCode,
  InternalError,
  NotFoundError,
  ValidationError,
  serializeError,
} from '../src/errors/index.js';

describe('serializeError', () => {
  it('exposes the message of a 4xx AppError', () => {
    const { status, body } = serializeError(
      new NotFoundError('Anime could not be found.', { code: ErrorCode.ANIME_NOT_FOUND }),
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe(ErrorCode.ANIME_NOT_FOUND);
    expect(body.error.message).toBe('Anime could not be found.');
  });

  it('hides the message of a non-exposed 5xx error', () => {
    const { status, body } = serializeError(
      new InternalError('connection to 10.0.0.4:5432 refused: password authentication failed'),
    );

    expect(status).toBe(500);
    expect(body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('5432');
  });

  it('flattens an unknown throw into a generic 500', () => {
    const { status, body } = serializeError(new Error('ECONNREFUSED /var/run/postgres.sock'));

    expect(status).toBe(500);
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(JSON.stringify(body)).not.toContain('postgres.sock');
  });

  it('includes field issues for validation errors', () => {
    const { status, body } = serializeError(
      new ValidationError('Request validation failed.', [{ path: 'email', message: 'Invalid email.' }]),
    );

    expect(status).toBe(422);
    expect(body.error.issues).toEqual([{ path: 'email', message: 'Invalid email.' }]);
  });

  it('attaches the request id when provided', () => {
    const { body } = serializeError(new NotFoundError(), { requestId: 'req_123' });
    expect(body.error.requestId).toBe('req_123');
  });

  it('never serializes the cause chain', () => {
    const { body } = serializeError(
      new InternalError('wrapped', { cause: new Error('SELECT * FROM users WHERE token = $1') }),
    );

    expect(JSON.stringify(body)).not.toContain('SELECT');
  });
});

describe('AppError', () => {
  it('defaults expose to false for 5xx and true for 4xx', () => {
    expect(new AppError('x', { status: 500 }).expose).toBe(false);
    expect(new AppError('x', { status: 400 }).expose).toBe(true);
  });

  it('reports its subclass name', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
  });
});
