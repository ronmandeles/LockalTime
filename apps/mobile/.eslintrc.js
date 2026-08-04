module.exports = {
  root: true,
  extends: '@react-native',
  plugins: ['i18next'],
  rules: {
    // No hardcoded UI strings (CLAUDE.md locked decision): all user-visible
    // copy flows through the i18n layer. 'jsx-only' validates JSX text plus
    // attributes; the include list scopes attribute checks to user-facing
    // props only, so non-copy attributes (testID, navigator route names)
    // stay unflagged.
    'i18next/no-literal-string': [
      'error',
      {
        mode: 'jsx-only',
        'jsx-attributes': {
          include: ['accessibilityLabel', 'accessibilityHint', 'placeholder', 'title', 'label'],
        },
      },
    ],
  },
  overrides: [
    {
      // Tests assert against literals (testIDs, fixture strings) by design.
      // `.test.tsx` is listed explicitly: the glob is literal, so `*.test.ts`
      // does NOT also match `*.test.tsx`, and component tests rendering JSX
      // fixtures live under that extension.
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.tsx', '__tests__/**'],
      rules: {
        'i18next/no-literal-string': 'off',
      },
    },
  ],
};
