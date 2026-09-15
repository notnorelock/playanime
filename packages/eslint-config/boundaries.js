/**
 * Package boundary enforcement.
 *
 * PlayAnime packages are organized into tiers. A package may import only from
 * strictly lower tiers, which makes the dependency graph acyclic by
 * construction rather than by convention.
 *
 *   Tier 0  shared                       (no workspace deps)
 *   Tier 1  contracts, config            -> shared
 *   Tier 2  logger                       -> shared, config
 *   Tier 3  database, redis              -> shared, config, logger
 *   Tier 4  auth, realtime, player, ui,
 *           external-media               -> tiers 0-3
 *   Tier 5  api, web                     -> tiers 0-4, never each other
 *
 * Adding a package means adding it here. If that feels annoying, that is the
 * rule doing its job: a new package is an architectural decision.
 */

const TIERS = [
  ['shared'],
  ['contracts', 'config'],
  ['logger'],
  ['database', 'redis'],
  ['auth', 'realtime', 'player', 'ui', 'external-media'],
  ['api', 'web'],
];

const ALL = TIERS.flat();

/** Packages a given package is allowed to import: everything strictly below it. */
function allowedFor(name) {
  const tier = TIERS.findIndex((group) => group.includes(name));
  if (tier < 0) throw new Error(`Unknown PlayAnime package: ${name}`);
  return TIERS.slice(0, tier).flat();
}

function forbiddenFor(name) {
  const allowed = new Set(allowedFor(name));
  return ALL.filter((candidate) => candidate !== name && !allowed.has(candidate));
}

/**
 * Builds the flat-config entries that hold each package to its tier.
 * Returns one config object per package, scoped by file path.
 */
export function boundaryConfigs() {
  return ALL.map((name) => {
    const forbidden = forbiddenFor(name);
    if (forbidden.length === 0) {
      // Tier 0: forbid every workspace import, including future packages.
      return {
        files: [`packages/${name}/**/*.{ts,tsx}`],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  group: ['@playanime/*'],
                  message:
                    '@playanime/shared is tier 0 and must have no workspace dependencies. See packages/shared/README.md.',
                },
              ],
            },
          ],
        },
      };
    }

    return {
      files: [`packages/${name}/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: forbidden.flatMap((dep) => [`@playanime/${dep}`, `@playanime/${dep}/*`]),
                message: `@playanime/${name} may not import this package: it is at the same tier or higher. See packages/eslint-config/boundaries.js.`,
              },
              {
                // Four or more levels up necessarily leaves the package: the
                // deepest source path in this repo is
                // packages/<pkg>/src/modules/<mod>/<file>. Three levels
                // (`../../plugins/`) is a legitimate intra-package import, so
                // matching `../../*` here was a false positive.
                group: ['../../../../*'],
                message:
                  'Reach across packages with the @playanime/* alias, never a relative path out of the package root.',
              },
            ],
          },
        ],
      },
    };
  });
}

export { TIERS, allowedFor, forbiddenFor };
