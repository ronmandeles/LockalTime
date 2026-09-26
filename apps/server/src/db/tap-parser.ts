// Parses the TAP output pgTAP writes through psql, replacing the pass/fail
// reporting `supabase test db` used to do (Phase 10, task 10.1).

export interface TapFailure {
  readonly number: number;
  readonly description: string;
}

export interface TapSummary {
  readonly ok: boolean;
  readonly planned: number | null;
  readonly ran: number;
  readonly passed: number;
  readonly failures: readonly TapFailure[];
}

const PLAN_LINE = /^\s*1\.\.(\d+)\s*$/;
const ASSERTION_LINE = /^\s*(not ok|ok)\s+(\d+)(?:\s*-?\s*(.*))?$/;

export const parseTapOutput = (output: string): TapSummary => {
  let planned: number | null = null;
  let ran = 0;
  let passed = 0;
  const failures: TapFailure[] = [];

  for (const line of output.split('\n')) {
    const planMatch = PLAN_LINE.exec(line);
    if (planMatch?.[1] !== undefined) {
      planned = Number(planMatch[1]);
      continue;
    }

    const assertionMatch = ASSERTION_LINE.exec(line);
    if (assertionMatch === null) {
      continue;
    }

    ran += 1;
    const number = Number(assertionMatch[2]);
    if (assertionMatch[1] === 'ok') {
      passed += 1;
    } else {
      failures.push({ number, description: (assertionMatch[3] ?? '').trim() });
    }
  }

  // A plan that is absent or unmet is as much a failure as a `not ok` line:
  // when psql aborts on a syntax error or a missing relation, pgTAP emits no
  // assertions at all, and zero failures must never read as a pass.
  const ok = planned !== null && ran === planned && ran > 0 && failures.length === 0;

  return { ok, planned, ran, passed, failures };
};
