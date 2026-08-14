/**
 * Fails when a server module imports a plain value out of a 'use client' one.
 *
 *     pnpm check:client-boundary
 *
 * The rule, the defect that motivated it and the reason no other gate in this
 * repo can see it live in scripts/lib/clientBoundary.ts. Read that file; this
 * one is only the command-line skin.
 *
 * The same scan also runs inside `pnpm test`
 * (src/tests/unit/clientBoundary.test.ts), so the rule survives a workflow
 * edit — a check that exists only as a CI step is one `paths-ignore:` away
 * from never running again.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClientBoundaryViolations, formatViolation } from './lib/clientBoundary';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const violations = findClientBoundaryViolations(rootDir);

if (violations.length === 0) {
  console.log('client boundary: no server module imports a value from a client module.');
  process.exit(0);
}

console.error(
  `client boundary: ${violations.length} server->client value ${violations.length === 1 ? 'import' : 'imports'}.\n`,
);
for (const violation of violations) console.error(`  ${formatViolation(violation)}`);
console.error(
  [
    '',
    'A value imported across this boundary is a client-reference proxy, not the',
    'thing it is declared as. Calling it throws at request time — "Attempted to',
    'call x() from the server but x is on the client" — and nothing else here',
    'catches it: tsc sees a real function, next build never renders a',
    'force-dynamic page, and vitest has no boundary at all.',
    '',
    'Move the shared value into a plain sibling module with no directive and',
    'import it from both sides, or use `import type` if it is only ever a type.',
  ].join('\n'),
);
process.exit(1);
