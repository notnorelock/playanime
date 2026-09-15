/**
 * Development helper: resolve a Google Drive file and print the full result.
 *
 * Usage:
 *   bun run packages/external-media/scripts/resolve-drive.ts <fileId> [resourceKey]
 *
 * Prints complete temporary videoplayback URLs. For local debugging only —
 * do not paste these into tickets/logs that leave your machine.
 */
import { GoogleDriveResolver } from '../src/index.js';

const fileId = process.argv[2];
const resourceKey = process.argv[3];

if (fileId === undefined || fileId.length === 0) {
  console.error('Usage: bun run packages/external-media/scripts/resolve-drive.ts <fileId> [resourceKey]');
  process.exit(1);
}

const resolver = new GoogleDriveResolver({
  logger: {
    info: (message, context) => {
      console.log(message, context ?? {});
    },
    warn: (message, context) => {
      console.warn(message, context ?? {});
    },
    error: (message, error, context) => {
      console.error(message, error, context ?? {});
    },
  },
});

const outcome = await resolver.resolve(fileId, resourceKey);

console.log(
  JSON.stringify(
    {
      status: outcome.status,
      access: outcome.access,
      playerUrl: outcome.playback.playerUrl,
      useHlsByDefault: outcome.playback.useHlsByDefault,
      expiresAt: outcome.playback.expiresAt?.toISOString() ?? null,
      streamUrls: outcome.playback.streamUrls.map((stream) => ({
        src: stream.src,
        resolution: stream.resolution ?? null,
        mimeType: stream.mimeType ?? null,
        itag: stream.itag ?? null,
      })),
    },
    null,
    2,
  ),
);
