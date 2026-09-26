import { parseTapOutput } from './tap-parser';

describe('parseTapOutput', () => {
  it('reports a fully passing run as ok with the planned count', () => {
    const summary = parseTapOutput(['1..3', 'ok 1 - a', 'ok 2 - b', 'ok 3 - c'].join('\n'));

    expect(summary).toEqual({ ok: true, planned: 3, ran: 3, passed: 3, failures: [] });
  });

  it('captures a failing assertion with its number and description', () => {
    const summary = parseTapOutput(
      ['1..3', 'ok 1 - a', 'not ok 2 - b is wrong', 'ok 3 - c'].join('\n'),
    );

    expect(summary.ok).toBe(false);
    expect(summary.failures).toEqual([{ number: 2, description: 'b is wrong' }]);
    expect(summary.passed).toBe(2);
  });

  it('collects every failure, not just the first', () => {
    const summary = parseTapOutput(['1..3', 'not ok 1 - a', 'ok 2 - b', 'not ok 3 - c'].join('\n'));

    expect(summary.failures.map((failure) => failure.number)).toEqual([1, 3]);
  });

  // pgTAP's plan is the guard against a test file dying halfway: the
  // assertions that did run all passed, and the file is still broken.
  it('is not ok when fewer assertions ran than were planned', () => {
    const summary = parseTapOutput(['1..3', 'ok 1 - a', 'ok 2 - b'].join('\n'));

    expect(summary.ok).toBe(false);
    expect(summary).toMatchObject({ planned: 3, ran: 2, passed: 2, failures: [] });
  });

  it('is not ok when more assertions ran than were planned', () => {
    const summary = parseTapOutput(['1..1', 'ok 1 - a', 'ok 2 - b'].join('\n'));

    expect(summary.ok).toBe(false);
    expect(summary).toMatchObject({ planned: 1, ran: 2 });
  });

  // The failure mode that matters most: a syntax error or a missing relation
  // makes psql abort before pgTAP emits anything. Zero failures and zero
  // assertions must never read as a pass, or a broken migration ships green.
  it('is not ok when psql errored before any TAP output was produced', () => {
    const summary = parseTapOutput(
      'psql:users_test.sql:9: ERROR:  relation "public.users" does not exist',
    );

    expect(summary.ok).toBe(false);
    expect(summary).toMatchObject({ planned: null, ran: 0, passed: 0 });
  });

  it('is not ok for empty output', () => {
    expect(parseTapOutput('').ok).toBe(false);
  });

  it('ignores diagnostic comment lines', () => {
    const summary = parseTapOutput(
      ['1..1', 'not ok 1 - a', '# Failed test 1: "a"', '# Looks like you failed 1 test of 1'].join(
        '\n',
      ),
    );

    expect(summary.ran).toBe(1);
    expect(summary.failures).toHaveLength(1);
  });

  it('tolerates the extra whitespace psql pads TAP output with', () => {
    const summary = parseTapOutput([' 1..2', ' ok 1 - a', ' not ok 2 - b'].join('\n'));

    expect(summary).toMatchObject({ planned: 2, ran: 2, passed: 1 });
    expect(summary.failures).toEqual([{ number: 2, description: 'b' }]);
  });

  it('reads an assertion with no description', () => {
    const summary = parseTapOutput(['1..1', 'ok 1'].join('\n'));

    expect(summary).toEqual({ ok: true, planned: 1, ran: 1, passed: 1, failures: [] });
  });
});
