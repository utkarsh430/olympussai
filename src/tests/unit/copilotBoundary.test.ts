// @vitest-environment node
//
// Static enforcement of the ticket's most load-bearing acceptance
// criterion: "No code path in the copilot module can call the
// command-creation/approval service." Rather than trust that nobody ever
// adds such an import later, this test scans every source file under the
// copilot module for import specifiers pointing at that service and fails
// if any appear — a regression here is a build failure, not something a
// reviewer has to notice by reading a diff.
//
// Deliberately scans only *import specifiers* (the string in
// `from '...'` / `require('...')` / `import('...')`), not whole-file text:
// several files in this module document the boundary in prose (naming
// consumeDispatcherAction, rbac/repo.ts, etc. as things they must NOT
// import), and a whole-file substring scan would flag its own explanatory
// comments as violations.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COPILOT_DIRS = [
  join(process.cwd(), 'src/lib/copilot'),
  join(process.cwd(), 'src/app/api/ops/control-room/copilot'),
];

// Anything that would let the copilot module create or approve a command:
// the RBAC repo's dispatcher-action functions, the control-room commands
// route, the dispatcher approvals route, and the control service's own
// webhook dispatch (which only fires as a side effect of command creation).
const FORBIDDEN_IMPORT_SUBSTRINGS = [
  'rbac/repo',
  'control-room/commands',
  'dispatcher/approvals',
  'webhooks/dispatch',
];

const IMPORT_SPECIFIER_PATTERN = /(?:from\s+|require\(|import\()\s*['"]([^'"]+)['"]/g;

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function importSpecifiersOf(contents: string): string[] {
  const specifiers: string[] = [];
  for (const match of contents.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

describe('copilot module boundary', () => {
  it('never imports the command-creation/approval service', () => {
    const violations: string[] = [];

    for (const dir of COPILOT_DIRS) {
      for (const file of walk(dir)) {
        const contents = readFileSync(file, 'utf8');
        for (const specifier of importSpecifiersOf(contents)) {
          for (const forbidden of FORBIDDEN_IMPORT_SUBSTRINGS) {
            if (specifier.includes(forbidden)) {
              violations.push(`${file}: imports "${specifier}" (matches forbidden "${forbidden}")`);
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('never fetches the control service commands endpoint directly', () => {
    const violations: string[] = [];

    for (const dir of COPILOT_DIRS) {
      for (const file of walk(dir)) {
        const contents = readFileSync(file, 'utf8');
        if (contents.includes("'/v1/commands'") || contents.includes('"/v1/commands"')) {
          violations.push(`${file}: references the /v1/commands endpoint`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('scanned at least the expected copilot files (guards against a silently-empty scan)', () => {
    const allFiles = COPILOT_DIRS.flatMap((dir) => walk(dir));
    expect(allFiles.length).toBeGreaterThanOrEqual(8);
  });
});
