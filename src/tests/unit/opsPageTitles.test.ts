// The ops page table, checked against the pages themselves — in the fast suite.
//
// ─── THE DRIFT THIS EXISTS TO STOP ───────────────────────────────────────
//
// tests/e2e/ops-dashboard-pages.spec.ts opens every guarded ops dashboard and
// proves it rendered by finding its <h1>. The expected headings live in a
// table (tests/e2e/fixtures/opsPages.ts), and that table has now drifted from
// the pages TWICE. The second time, the admin console was renamed into plain
// English — "Admin · People" -> "People", "Admin · Rollout stages" ->
// "Command permissions", "Admin · Network" -> "Network coverage" — and the
// suite fell to 20/23 against a 23/23 baseline while the pages themselves were
// perfectly fine. The pathname assertions all passed; only the headings were
// stale.
//
// The reason it kept happening is not carelessness, it is FEEDBACK DISTANCE.
// That suite needs an ops database and a seeded account for each of seven
// roles, so it skips locally and runs only in CI. Nothing a contributor could
// run before pushing had any opinion about a renamed heading.
//
// This file closes that gap: same table, same pages, no database, no server,
// no browser. It reads each page's source and asserts the table still
// describes it. A rename now fails `pnpm test` in milliseconds, with a message
// naming the old and new heading, instead of failing CI minutes later.
//
// ─── WHY IT READS SOURCE RATHER THAN RENDERING ───────────────────────────
//
// These are async server components that call `requireOpsRolePage`, which
// reads `ops_users`. Rendering one means a database and a session; the whole
// point here is a check that needs neither. The two facts being asserted —
// which title the page hands OpsShell, and which role it guards on — are both
// written literally in the source, and opsShell.test.tsx already establishes
// the precedent of reading the App Router directory this way.
//
// It deliberately does NOT replace the e2e assertion. That one proves a real
// browser, against a real server, with a real session, saw that heading; this
// proves the two written-down descriptions of the console agree.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { OPS_PAGES } from '../../../tests/e2e/fixtures/opsPages';

const OPS_ROOT = join(process.cwd(), 'src/app/(ops)/ops');

/** Reachable without a session, so not part of the guarded set. */
const PUBLIC_PAGES = ['login', 'forbidden', 'accept-invite', 'unavailable'];

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === 'page.tsx' ? [full] : [];
  });
}

function guardedPageFiles(): string[] {
  return pageFiles(OPS_ROOT).filter(
    (file) => !PUBLIC_PAGES.some((name) => file.includes(`${sep}${name}${sep}`)),
  );
}

/**
 * The route a page file serves, as segments, with `[id]` left as a wildcard.
 * `src/app/(ops)/ops/control-room/incidents/[id]/page.tsx` -> ['control-room',
 * 'incidents', '[id]'].
 */
function routeSegments(file: string): string[] {
  return relative(OPS_ROOT, file)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !segment.startsWith('(') && segment !== '');
}

/** Does this page file serve the given concrete path? */
function serves(file: string, path: string): boolean {
  const wanted = path.replace(/^\/ops\/?/, '').split('/').filter(Boolean);
  const actual = routeSegments(file);
  if (wanted.length !== actual.length) return false;
  return actual.every(
    (segment, i) => segment.startsWith('[') || segment === wanted[i],
  );
}

/**
 * The title a page hands its OpsShell.
 *
 * Anchored on `<OpsShell` rather than on the first `title=` in the file: these
 * pages also pass `title` to OpsAlert, OpsPanel and OpsSection, sometimes
 * above the shell. `depot/page.tsx` opens three shells (loading, error and the
 * real one) and every one carries the same heading, so the first is
 * representative — but all of them are collected and disagreement is reported
 * rather than hidden.
 */
function declaredTitles(source: string): string[] {
  const titles: string[] = [];
  for (const match of source.matchAll(/<OpsShell\b/g)) {
    const rest = source.slice(match.index, match.index + 600);
    const title = /\btitle=(?:"([^"]*)"|\{'([^']*)'\})/.exec(rest);
    if (title) titles.push(title[1] ?? title[2] ?? '');
  }
  return titles;
}

/** The role a page's guard actually enforces. */
function declaredRole(source: string): string | null {
  return /requireOpsRolePage\(\s*'([a-z_]+)'/.exec(source)?.[1] ?? null;
}

describe('the ops page table still describes the ops pages', () => {
  const files = guardedPageFiles();

  it('covers every guarded page, and no page that does not exist', () => {
    const uncovered = files
      .filter((file) => !OPS_PAGES.some((row) => serves(file, row.path)))
      .map((file) => relative(process.cwd(), file));
    const unmatched = OPS_PAGES.filter(
      (row) => !files.some((file) => serves(file, row.path)),
    ).map((row) => row.path);

    expect(uncovered, 'guarded pages with no row in the table').toEqual([]);
    expect(unmatched, 'table rows that match no page in the App Router').toEqual([]);
    expect(files.length).toBe(OPS_PAGES.length);
  });

  it('expects the heading each page actually renders', () => {
    // The exact drift that took the suite to 20/23.
    const wrong: string[] = [];
    for (const row of OPS_PAGES) {
      const file = files.find((candidate) => serves(candidate, row.path));
      if (!file) continue;
      const titles = declaredTitles(readFileSync(file, 'utf8'));

      if (titles.length === 0) {
        wrong.push(`${row.path}: no <OpsShell title=…> found in ${relative(process.cwd(), file)}`);
        continue;
      }
      const distinct = [...new Set(titles)];
      if (distinct.length > 1) {
        wrong.push(`${row.path}: page renders disagreeing headings ${distinct.join(' / ')}`);
        continue;
      }
      if (distinct[0] !== row.title) {
        wrong.push(`${row.path}: page renders "${distinct[0]}", table expects "${row.title}"`);
      }
    }

    expect(
      wrong,
      'The e2e page table has drifted from the pages. Update the `title` in ' +
        'tests/e2e/fixtures/opsPages.ts to the heading the page now renders — ' +
        'the e2e suite finds that <h1> to prove the dashboard opened rather ' +
        'than redirecting to sign-in, and a stale row fails it.',
    ).toEqual([]);
  });

  it('expects the role each page actually guards on', () => {
    // A row naming the wrong role would sign in as an operator who cannot open
    // the page, and the suite would report a guard failure as a page failure.
    const wrong: string[] = [];
    for (const row of OPS_PAGES) {
      const file = files.find((candidate) => serves(candidate, row.path));
      if (!file) continue;
      const role = declaredRole(readFileSync(file, 'utf8'));
      if (role === null) {
        wrong.push(`${row.path}: no requireOpsRolePage call found`);
      } else if (role !== row.role) {
        wrong.push(`${row.path}: page guards on "${role}", table says "${row.role}"`);
      }
    }

    expect(wrong, 'the table disagrees with the guards the pages call').toEqual([]);
  });
});
