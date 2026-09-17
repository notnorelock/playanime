/* eslint-disable no-console */
import { runSync } from './sync.js';

/**
 * Usage:
 *   bun run import:anilist -- [--season winter|spring|summer|fall] [--year 2026]
 *     [--limit 5] [--dry-run] [--use-jikan]
 *
 * DEEPL_API_KEY is read from the environment — omit it to skip Polish
 * translation entirely (genres/tags fall back to their English name via
 * the existing `namePolish ?? name` resolution, same as an untranslated
 * row today).
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const season = argValue('--season');
const yearArg = argValue('--year');
const limitArg = argValue('--limit');
const dryRun = process.argv.includes('--dry-run');
const useJikan = process.argv.includes('--use-jikan');

async function main(): Promise<void> {
  console.log(
    `Starting AniList import${dryRun ? ' (dry run — nothing will be written)' : ''}${useJikan ? ' with Jikan cross-reference' : ''}...`,
  );

  const stats = await runSync({
    season: season?.toUpperCase(),
    seasonYear: yearArg === undefined ? undefined : Number(yearArg),
    limit: limitArg === undefined ? undefined : Number(limitArg),
    dryRun,
    useJikan,
    deeplApiKey: process.env['DEEPL_API_KEY'],
    onLog: console.log,
  });

  console.log('Import complete:');
  console.log(`  Fetched:  ${String(stats.fetched)}`);
  console.log(`  Created:  ${String(stats.imported)}`);
  console.log(`  Updated:  ${String(stats.updated)}`);
  console.log(`  Skipped:  ${String(stats.skipped)}`);
  console.log(`  Genres translated: ${String(stats.genresTranslated)}`);
  console.log(`  Tags translated:   ${String(stats.tagsTranslated)}`);
}

main().catch((error: unknown) => {
  console.error('Import failed:', error);
  process.exit(1);
});
