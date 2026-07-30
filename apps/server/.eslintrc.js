module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2022: true,
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // Enables the prettier rule using the repo-root .prettierrc (resolved per file) and
    // disables ESLint rules that would conflict with it. Prettier stays the single
    // source of truth for formatting per .claude/skills/code-style/SKILL.md.
    'plugin:prettier/recommended',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'error',
    // Import group order per .claude/skills/code-style/SKILL.md: built-ins, third-party, internal
    // absolute, relative — blank line between groups.
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
        'newlines-between': 'always',
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.test.ts'],
      env: { jest: true },
    },
  ],
  // loadtest/ is a standalone, plain-Node CJS ops script (Phase 7) run
  // directly with `node`, not part of the TS app build — it deliberately
  // doesn't follow the app's TS/import-order/module conventions.
  ignorePatterns: ['dist/', 'coverage/', 'node_modules/', 'loadtest/'],
};
