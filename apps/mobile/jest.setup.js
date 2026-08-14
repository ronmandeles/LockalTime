/* eslint-env node, es2020 */

// Shared harness for every mobile spec. Runs once per test file, before any
// test in it — see `setupFilesAfterEnv` in jest.config.js.
//
// It exists because of a flake that looked like a component bug and was not:
// specs failed on a cold cache with `render function has not been called`, or
// with a waitFor that never saw an effect run. Both trace back to ONE cause in
// two parts, and both parts have to be fixed or the flake only gets rarer.

const { configure } = require('@testing-library/react-native');

// PART 1 — the budget.
//
// RNTL's async utilities (waitFor, findBy*) have their own timeout, default
// 1000ms. jest.config.js's `testTimeout: 20000` does NOT apply to it: they are
// two independent budgets, and that is exactly the trap this repo already fell
// into once. The cold-cache transform cost was diagnosed correctly and fixed at
// the jest level, while the 1s budget underneath every `await waitFor(...)` was
// left at its default and kept failing.
//
// 5s is measured, not guessed — it cleared the reproducer that the 1s default
// failed every time. It is a guardrail, not the fix: raising it alone was
// measured NOT to be enough under load, which is what Part 2 is for.
const ASYNC_BUDGET_MS = 5000;
configure({ asyncUtilTimeout: ASYNC_BUDGET_MS });

// PART 2 — pay the transform before anything is timed.
//
// The real cost is one-time and structural: React Native's index.js exposes its
// components through lazy getters, so most of the renderer and the core
// components are not require()d — and therefore not babel-transformed — until
// something actually renders them. In a spec that means the FIRST render()
// inside the FIRST test pays for the whole tree, while a 1s stopwatch is
// already running.
//
// Touching each lazy getter forces its require() — and therefore its babel
// transform — to happen HERE, at setup time, instead of inside the first
// render() while a stopwatch runs.
//
// It deliberately does NOT render anything. A throwaway render() was tried
// first and is the wrong tool: RNTL tracks rendered roots globally, and a
// warm-up tree corrupts that tracking even when cleaned up — the symptom is
// `toBeOnTheScreen()` reporting "instance could not be found in the instance
// tree" for an element `findByText` had just found. Measured: it broke the
// first test of five screen specs deterministically, on both a synchronous
// cleanup() and an awaited one inside beforeAll. Requiring the modules buys the
// transform, which is the actual cost, and touches no RNTL state at all.
const reactNative = require('react-native');

[
  'ActivityIndicator',
  'Alert',
  'Animated',
  'FlatList',
  'Image',
  'Modal',
  'Platform',
  'Pressable',
  'ScrollView',
  'StyleSheet',
  'Switch',
  'Text',
  'TextInput',
  'TouchableOpacity',
  'View',
].forEach((componentName) => {
  // The property access IS the work — RN's index.js defines these as getters
  // that require() on first read. Asserting the result is non-undefined does
  // that job and doubles as a staleness guard: if React Native renames or drops
  // an export, this list silently stops warming anything and the flake quietly
  // returns. Better to fail here, loudly, than to lose the fix without noticing.
  if (reactNative[componentName] === undefined) {
    throw new Error(
      `react-native no longer exports ${componentName} — update the warm-up list in jest.setup.js`,
    );
  }
});

// NOT warmed here, deliberately: the app's i18n graph. Screen specs also pay for
// i18next and both locale modules inside that same first render, so warming it
// looks like the obvious next step — but `init-i18n` imports
// react-native-localize, whose TurboModule throws outside a real app. A setup
// file runs before a spec's jest.mock() registrations take effect, so the real
// module gets pulled in and EVERY suite dies with
// "TurboModuleRegistry.getEnforcing('RNLocalize') could not be found". Measured:
// 70 suites failed to run, 0 tests. Only dependency-free module graphs can be
// warmed from here.

// Read back by __tests__/jest-harness.test.ts. RNTL exports `configure` but no
// `getConfig`, so this marker is the only way a test can assert the harness
// actually ran rather than silently going missing.
globalThis.lockalTimeHarness = {
  asyncBudgetMs: ASYNC_BUDGET_MS,
  renderWarmUpComplete: true,
};
