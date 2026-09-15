import { describe, expect, it } from 'bun:test';
import { Writable } from 'node:stream';
import { createLogger, silentLogger } from '../src/index.js';

/** Collects newline-delimited JSON log lines for assertion. */
function collector(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  it('emits structured JSON with level and message', () => {
    const sink = collector();
    createLogger({ destination: sink.stream, level: 'info' }).info('anime listed');

    const [line] = sink.lines();
    expect(line?.['level']).toBe('info');
    expect(line?.['msg']).toBe('anime listed');
    expect(line?.['time']).toBeDefined();
  });

  it('attaches structured context', () => {
    const sink = collector();
    createLogger({ destination: sink.stream }).info('request completed', {
      requestId: 'req_1',
      userId: 'usr_9',
      route: '/api/v1/anime',
      status: 200,
      durationMs: 12,
    });

    const [line] = sink.lines();
    expect(line?.['requestId']).toBe('req_1');
    expect(line?.['route']).toBe('/api/v1/anime');
    expect(line?.['status']).toBe(200);
  });

  it('redacts secrets at the top level', () => {
    const sink = collector();
    const logger = createLogger({ destination: sink.stream });
    logger.info('login attempt', { 'data.password': 'hunter2' } as never);
    logger.info('token issued', { token: 'secret-token-value' } as never);

    const output = JSON.stringify(sink.lines());
    expect(output).not.toContain('secret-token-value');
    expect(output).toContain('[redacted]');
  });

  it('redacts authorization and cookie headers', () => {
    const sink = collector();
    createLogger({ destination: sink.stream }).info('inbound', {
      req: { headers: { authorization: 'Bearer abcdef', cookie: 'playanime_session=zzz' } },
    } as never);

    const output = JSON.stringify(sink.lines());
    expect(output).not.toContain('abcdef');
    expect(output).not.toContain('playanime_session=zzz');
  });

  it('serializes an error with its stack', () => {
    const sink = collector();
    createLogger({ destination: sink.stream }).error('query failed', new Error('boom'), {
      module: 'anime',
    });

    const [line] = sink.lines();
    expect(line?.['level']).toBe('error');
    const err = line?.['err'] as { message: string; stack: string } | undefined;
    expect(err?.message).toBe('boom');
    expect(err?.stack).toContain('Error: boom');
  });

  it('normalizes a non-Error throw', () => {
    const sink = collector();
    createLogger({ destination: sink.stream }).error('odd failure', 'a string was thrown');

    const err = sink.lines()[0]?.['err'] as { message: string } | undefined;
    expect(err?.message).toBe('a string was thrown');
  });

  it('honours the configured level', () => {
    const sink = collector();
    const logger = createLogger({ destination: sink.stream, level: 'warn' });
    logger.debug('ignored');
    logger.info('ignored');
    logger.warn('kept');

    expect(sink.lines()).toHaveLength(1);
    expect(sink.lines()[0]?.['msg']).toBe('kept');
  });

  it('stamps child bindings onto every line', () => {
    const sink = collector();
    const child = createLogger({ destination: sink.stream }).child({ module: 'external-media' });
    child.info('provider resolved');
    child.info('descriptor built');

    for (const line of sink.lines()) {
      expect(line['module']).toBe('external-media');
    }
  });
});

describe('silentLogger', () => {
  it('discards output and returns itself from child', () => {
    expect(() => silentLogger.error('nothing', new Error('x'))).not.toThrow();
    expect(silentLogger.child({ module: 'x' })).toBe(silentLogger);
  });
});
