// @vitest-environment node
//
// The server/client import boundary, as a gate that runs on every `pnpm test`.
//
// Same scan as `pnpm check:client-boundary`, asserted here as well so the rule
// survives a workflow edit: a check that exists only as a CI step is one
// `paths-ignore:` away from never running again, and the defect it catches
// (a whole ops page returning HTTP 500 on 100% of requests) is one that tsc,
// next lint, next build and the rest of this suite are all structurally blind
// to. scripts/lib/clientBoundary.ts holds the rule and that reasoning.
//
// Same belt-and-suspenders shape as copilotBoundary.test.ts next door.
//
// Deliberately a whole-tree assertion with no allowlist: the failure mode is a
// NEW crossing appearing anywhere, and there is nothing legitimate to allow.
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { findClientBoundaryViolations, formatViolation } from '../../../scripts/lib/clientBoundary';

const ROOT = process.cwd();

describe('server modules never import a value out of a client module', () => {
  it('finds no crossing anywhere under src/', () => {
    const violations = findClientBoundaryViolations(ROOT);

    // Compared as the scanner's own formatted lines, not as a count: a failure
    // here has to name the file and the import, or the next engineer has to
    // rerun the script to learn anything from it.
    expect(violations.map(formatViolation)).toEqual([]);
  });

  // Guards the guard. A scanner that silently stopped matching anything would
  // satisfy the assertion above forever — the failure mode of every whole-tree
  // check ever written.
  it('still detects a crossing when one is present', () => {
    const violations = findClientBoundaryViolations(ROOT, ['src/tests/fixtures/clientBoundary']);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      imported: 'isConsoleTab',
      local: 'isConsoleTab',
      file: path.join('src/tests/fixtures/clientBoundary', 'serverImporter.ts'),
      target: path.join('src/tests/fixtures/clientBoundary', 'clientModule.tsx'),
    });
  });

  it('leaves a client component import and a type-only import alone', () => {
    expect(findClientBoundaryViolations(ROOT, ['src/tests/fixtures/clientBoundaryClean'])).toEqual([]);
  });
});
