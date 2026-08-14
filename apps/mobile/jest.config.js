module.exports = {
  preset: '@react-native/jest-preset',
  // The RN preset only transforms react-native itself; these ship untranspiled
  // ESM/JSX and must not be ignored by Babel.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-is-edge-to-edge)/)',
  ],
  // integration/ hits the real local Supabase stack — run it explicitly via
  // `npm run test:integration` (jest.integration.config.js), never as part of
  // the default unit suite.
  testPathIgnorePatterns: ['/node_modules/', '/integration/'],
  // Jest's default is 5000ms, which four screen specs blow through on a COLD
  // babel cache: the transform of the whole RN + i18n dependency graph happens
  // inside the first test's render, not before it, so that one test pays for
  // the entire module tree. Warm runs finish it in ~15s and never came close.
  //
  // Found during Phase 9 and reproduced on unmodified main, so it predates the
  // feature — but the important part is WHERE it bites: CI checks out fresh
  // every run, so CI has been running with a cold cache all along and passing
  // on margin rather than by design. `npx jest --clearCache` reproduces it
  // locally every time.
  //
  // A timeout is the right lever rather than per-test waitFor tuning: nothing
  // here is actually slow, and a real hang still fails, just 15s later.
  //
  // NOT sufficient on its own, discovered 2026-08-14: `testTimeout` governs the
  // jest test, while RNTL's waitFor/findBy* enforce a SEPARATE 1000ms budget
  // that this setting never touches. The same cold-cache transform cost kept
  // blowing that one, which is what jest.setup.js addresses.
  testTimeout: 20000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
