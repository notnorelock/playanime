import { start } from './server.js';

/**
 * API entrypoint.
 *
 * Kept separate from `server.ts` so the app can be imported by tests without
 * binding a port — importing a module that listens as a side effect makes
 * integration tests fight over the port and leak handles.
 */
start();
