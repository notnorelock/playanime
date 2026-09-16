import { base, boundaryConfigs } from '@playanime/eslint-config';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/database/src/migrations/**',
      'packages/eslint-config/**',
      /*
       * The Vue web app.
       *
       * Its `.vue` single-file components need `vue-eslint-parser`, and its
       * TypeScript lives in a separate tsconfig outside the root build graph —
       * so the type-aware rules here cannot resolve it and report every import
       * as `any`. It is typechecked by `vue-tsc` in its own package instead,
       * which is the check that actually understands the framework.
       *
       * Linting it properly means adding eslint-plugin-vue and a scoped parser
       * block; until then, running these rules against it produces hundreds of
       * false positives that bury real findings in the backend packages.
       */
      'packages/web/**',
      // Utility scripts, deliberately outside every package's build tsconfig.
      'scripts/**',
      'packages/*/scripts/**',
    ],
  },
  ...base,
  {
    // Type-aware rules need tests in a project. The build tsconfig is
    // src-only so tests never reach dist/, hence a sibling config per package.
    files: ['packages/*/tests/**/*.ts', 'packages/*/drizzle.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['packages/*/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...boundaryConfigs(),
];
