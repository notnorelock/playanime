import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';
import { toLoggableError } from '@playanime/shared';
import { REDACTED_PATHS, REDACTION_PLACEHOLDER } from './redact.js';

export { REDACTED_PATHS } from './redact.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Structured context attached to log lines.
 *
 * Deliberately a closed shape rather than `Record<string, unknown>`: these are
 * the fields dashboards and alerts query on, so they must be spelled
 * consistently. Ad-hoc detail goes in `data`.
 */
export interface LogContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  module?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  provider?: string;
  sourceId?: string;
  [key: `data.${string}`]: unknown;
}

export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  /** Errors always take the cause, so the stack reaches the log. */
  error(message: string, error?: unknown, context?: LogContext): void;
  fatal(message: string, error?: unknown, context?: LogContext): void;
  /** Derives a logger that stamps `bindings` onto every line. */
  child(bindings: LogContext): Logger;
}

export interface CreateLoggerOptions {
  level?: LogLevel;
  pretty?: boolean;
  /** Service name, so multiple processes are distinguishable in aggregation. */
  name?: string;
  /** Test seam: write to a custom destination. */
  destination?: NodeJS.WritableStream;
}

function baseOptions(options: CreateLoggerOptions): LoggerOptions {
  return {
    name: options.name ?? 'playanime',
    level: options.level ?? 'info',
    redact: { paths: [...REDACTED_PATHS], censor: REDACTION_PLACEHOLDER },
    // ISO timestamps: log collectors parse them without a custom rule.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // `level: "info"` reads better in aggregation than pino's numeric default.
      level: (label) => ({ level: label }),
    },
    base: { pid: process.pid },
  };
}

class PinoAdapter implements Logger {
  constructor(private readonly instance: PinoLogger) {}

  trace(message: string, context?: LogContext): void {
    this.instance.trace(context ?? {}, message);
  }

  debug(message: string, context?: LogContext): void {
    this.instance.debug(context ?? {}, message);
  }

  info(message: string, context?: LogContext): void {
    this.instance.info(context ?? {}, message);
  }

  warn(message: string, context?: LogContext): void {
    this.instance.warn(context ?? {}, message);
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    this.instance.error({ ...context, err: error === undefined ? undefined : toLoggableError(error) }, message);
  }

  fatal(message: string, error?: unknown, context?: LogContext): void {
    this.instance.fatal({ ...context, err: error === undefined ? undefined : toLoggableError(error) }, message);
  }

  child(bindings: LogContext): Logger {
    return new PinoAdapter(this.instance.child(bindings));
  }
}

/**
 * Builds a logger.
 *
 * Pretty transport is opt-in and dev-only: it is a separate worker thread and
 * emits unparseable output, both of which are wrong in production.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const config = baseOptions(options);

  if (options.destination) {
    return new PinoAdapter(pino(config, options.destination));
  }

  if (options.pretty) {
    return new PinoAdapter(
      pino({
        ...config,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,name' },
        },
      }),
    );
  }

  return new PinoAdapter(pino(config));
}

/**
 * A logger that discards everything. For tests that exercise code paths which
 * log, without polluting test output.
 */
export const silentLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => silentLogger,
};
