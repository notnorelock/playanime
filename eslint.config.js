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
  ...solidConfig,
  ...boundaryConfigs(),
];
