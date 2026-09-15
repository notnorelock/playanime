import { base, solidConfig, boundaryConfigs } from '@playanime/eslint-config';

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
  ...solidConfig,
  ...boundaryConfigs(),
];
