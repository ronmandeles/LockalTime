// Guards the shared harness in jest.setup.js that every spec inherits.
//
// The flake this exists to prevent: RNTL's async utilities (waitFor,
// findBy*) carry their OWN timeout — 1000ms by default — and
// jest.config.js's testTimeout does nothing for it. They are two separate
// budgets, which is precisely the trap that produced the bug: testTimeout
// was raised to 20s for the cold-cache transform cost, and the 1s budget
// sitting underneath it was left alone. On a cold cache the first render()
// in a spec pays the babel transform of the whole RN + i18n graph inside a
// timed wait, blows the 1s, and the spec goes red for a reason that has
// nothing to do with the code under test.
//
// Reproducer: `npx jest --clearCache && npm test`, which failed reliably
// before this harness existed and passes after it.
//
// Both halves of the fix are asserted here because both are invisible from
// a spec: nothing at a waitFor call site reveals the budget it was given,
// and nothing reveals that the transform had already been paid.
//
// WHAT THIS DOES NOT PROVE: RNTL exports `configure` but not `getConfig`,
// so there is no public way to read the budget back. These assertions prove
// the harness ran and what it asked for — not that RNTL stored it. That is
// the realistic regression anyway: the setup file getting unwired or
// dropped from jest.config.js, not RNTL silently ignoring its own API.

interface HarnessMarker {
  readonly asyncBudgetMs?: number;
  readonly renderWarmUpComplete?: boolean;
}

// Measured rather than guessed. 5s cleared the reproducer where the 1s
// default failed it every time — but padding ALONE was measured not to be
// enough under load, so the warm-up is what makes 5s ample instead of
// merely optimistic. Raising this number is not the fix if it regresses.
const MIN_ASYNC_BUDGET_MS = 5000;

const readHarness = (): HarnessMarker => {
  const marker = (globalThis as { lockalTimeHarness?: HarnessMarker }).lockalTimeHarness;
  if (marker === undefined) {
    throw new Error('jest.setup.js did not run — check setupFilesAfterEnv in jest.config.js');
  }
  return marker;
};

describe('the shared jest harness', () => {
  it('gives RNTL async utilities a budget a cold cache cannot blow', () => {
    expect(readHarness().asyncBudgetMs).toBeGreaterThanOrEqual(MIN_ASYNC_BUDGET_MS);
  });

  it('pays the render-path transform before any test is timed', () => {
    expect(readHarness().renderWarmUpComplete).toBe(true);
  });
});
