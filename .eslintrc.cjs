module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  overrides: [{ files: ['**/*.test.ts', '**/*.test.tsx'], rules: { '@typescript-eslint/no-explicit-any': 'off' } }],
  rules: {
    // TypeScript's noUnusedLocals/noUnusedParameters check understands type-only references.
    '@typescript-eslint/no-unused-vars': 'off',
    'no-undef': 'off',
    'no-constant-condition': ['error', { checkLoops: false }],
    // Input validators intentionally reject control characters.
    'no-control-regex': 'off',
  },
};
