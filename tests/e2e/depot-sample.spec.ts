import fs from 'node:fs';
import path from 'node:path';
import {
  test,
  expect,
  E2E_PIN,
  IN_CI,
  PIN_MISSING,
  SIGNED_OUT,
  collectConsoleErrors,
} from './depot-sample-fixtures';

/**
 * The depot module against the SAVED SAMPLE (`npm run test:e2e:sample`: the server runs with
 * `NEXT_PUBLIC_DEMO_MODE=1`, so the feed time, the depots and every count are fixed).
 *
 * Covered: the API contract of every depot route, every depot page rendering honestly, no
 * sideways page scroll, deep links, the cockpit-to-roster and exceptions scoping, keyboard
 * row opening, the copilot on its scripted writer, the route drawer's refusal on the sample,
 * and the sample never presented as live.
 *
 * Not covered here, because it needs the live feed: the populated route drawer (the route
 * details come from the corporation's schedule service, server side, which a browser test
 * cannot stub) and the freshness wiring (the stale notice after the stale limit with the
 * live feed blocked). Unit tests cover the timing of the latter.
 */

if (!E2E_PIN) {
  console.warn(
    `[depot sample e2e] SKIPPED: ${PIN_MISSING}.` +
      (IN_CI ? ' The PIN guard fails this CI run.' : ' Set it to run them.'),
  );
}

test('the depot sample suite has its PIN (it fails in CI when the PIN is missing)', () => {
  test.skip(!E2E_PIN && !IN_CI, `SKIPPED: ${PIN_MISSING}`);
  expect(E2E_PIN, `${PIN_MISSING}; a CI run without it must fail, not pass`).toBeTruthy();
});
