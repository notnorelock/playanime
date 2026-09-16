import { FormatRegistry } from '@sinclair/typebox';

/**
 * String formats, registered for tests.
 *
 * The contracts declare `format: 'uuid'`, `'uri'` and so on, but deliberately
 * register no validators: at runtime Elysia compiles the schemas and supplies
 * its own. `Value.Check` has no such support, and an unregistered format fails
 * *open* in TypeBox — every value passes — which would make a format assertion
 * in a test silently meaningless.
 *
 * Registering them here keeps the tests honest without adding a format
 * implementation to the published package.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Deliberately loose: these mirror what the schemas actually rely on, not a
// full RFC implementation.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

let registered = false;

/** Registers the formats used by the contract schemas. Idempotent. */
export function registerTestFormats(): void {
  if (registered) return;
  registered = true;

  FormatRegistry.Set('uuid', (value) => UUID.test(value));
  FormatRegistry.Set('email', (value) => EMAIL.test(value));
  FormatRegistry.Set('date', (value) => DATE.test(value));
  FormatRegistry.Set('date-time', (value) => DATE_TIME.test(value));
  FormatRegistry.Set('uri', (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  });
}
