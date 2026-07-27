import { appBlocker } from './app-blocker';

// Phase 3 task 3.0 (backlog.md): the AppBlockerModule contract. Mirrors the
// blockingPermissions seam from Phase 1 — useAppBlocker (task 3.1) and any
// screen code against this interface only, so 3.3 (Android) / 3.6 (iOS) can
// swap in real native-backed implementations later without touching a call
// site (.claude/skills/testing-standards/SKILL.md native-modules rule:
// JS-side contract test over a mocked/absent bridge; real OS behavior is
// manual QA once the native modules land).
//
// This task's implementation is a deterministic pure-JS placeholder, same
// reasoning as blockingPermissions Phase 1: nothing native exists yet to
// start/stop/poll, so start()/stop() no-op, getStatus() always reports
// 'inactive', and addEventListener() never fires — real behavior arrives
// with the native modules. Determinism: no timers, no native bridge, no
// storage.

describe('appBlocker.start / stop', () => {
  it('resolves without throwing for any session config', async () => {
    await expect(
      appBlocker.start({ sessionId: 'session-1', endsAt: null, blockedCategories: ['social'] }),
    ).resolves.toBeUndefined();
  });

  it('resolves without throwing when stopped without ever being started', async () => {
    await expect(appBlocker.stop()).resolves.toBeUndefined();
  });
});

describe('appBlocker.getStatus', () => {
  it("resolves { state: 'inactive' } — the placeholder has no native source to consult", async () => {
    await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'inactive' });
  });

  it("still resolves { state: 'inactive' } after start() — the placeholder cannot actually enforce a block", async () => {
    await appBlocker.start({ sessionId: 'session-1', endsAt: null, blockedCategories: ['social'] });
    await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'inactive' });
  });
});

describe('appBlocker.addEventListener', () => {
  it('returns an unsubscribe function', () => {
    const unsubscribe = appBlocker.addEventListener(() => {});
    expect(typeof unsubscribe).toBe('function');
  });

  it('never invokes the listener — no native bridge exists yet to emit from', () => {
    const listener = jest.fn();
    appBlocker.addEventListener(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribing is safe to call more than once', () => {
    const unsubscribe = appBlocker.addEventListener(() => {});
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });
});
