import solid from 'eslint-plugin-solid/configs/typescript';

/**
 * SolidJS rules for packages rendering components.
 *
 * Solid's reactivity is compile-time, so destructuring props or reading a
 * signal outside a tracked scope silently breaks updates with no runtime
 * warning. These rules catch that class of bug statically.
 */
export const solidConfig = [
  {
    files: ['packages/{web,ui}/**/*.{ts,tsx}'],
    ...solid,
    rules: {
      ...solid.rules,
      'solid/reactivity': 'error',
      'solid/no-destructure': 'error',
      'solid/jsx-no-undef': 'error',
      'solid/components-return-once': 'warn',
      'solid/prefer-for': 'error',
    },
  },
];

export default solidConfig;
