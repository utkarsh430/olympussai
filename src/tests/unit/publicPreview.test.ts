// @vitest-environment node
//
// The tripwire for the branch-local login bypass (src/lib/auth/publicPreview.ts).
//
// Two things are being protected here and only one of them is the bypass.
//
// The load-bearing one is the FIRST test: under the test runner the switch
// must default to auth ON. Every other auth test in this suite — the
// middleware role gate, the session authority, the project-surface gate,
// ~30 files' worth — asserts what happens when a request is refused, and all
// of them would still pass, vacuously and silently, if the bypass leaked into
// the runner and made every one of those requests succeed. A green suite would
// then say nothing about the gates it exists to protect. This is the same
// failure the DB-backed tests' CI hard-fail guard exists for (see CLAUDE.md).
//
// The second is that "unset" really does mean DISABLED off the runner, since
// that, and not any variable anybody remembers to set, is what makes the
// preview deployment loginless.
import { afterEach, describe, expect, it } from 'vitest';
import {
  isAuthDisabled,
  previewClaimsFor,
  PREVIEW_DEFAULT_ROLE,
  PREVIEW_OPS_EMAIL,
  PREVIEW_OPS_SUBJECT,
} from '@/lib/auth/publicPreview';

// `process.env.NODE_ENV` is typed readonly, and these tests exist precisely to
// move it. The alias mutates the same object at runtime, which is what the
// module under test reads.
const env = process.env as Record<string, string | undefined>;

const KEYS = ['DISABLE_AUTH', 'NEXT_PUBLIC_DISABLE_AUTH', 'VITEST', 'NODE_ENV'] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete env[key];
    else env[key] = original[key];
  }
});

/** Whatever this process is, make it look like a deployed server. */
function pretendDeployed(): void {
  delete env.VITEST;
  env.NODE_ENV = 'production';
}

describe('the public-preview switch', () => {
  it('leaves authentication ON under the test runner, so the auth suite still proves something', () => {
    delete env.DISABLE_AUTH;
    delete env.NEXT_PUBLIC_DISABLE_AUTH;
    expect(isAuthDisabled()).toBe(false);
  });

  it('defaults to auth OFF on a deployed build with no variable set', () => {
    delete env.DISABLE_AUTH;
    delete env.NEXT_PUBLIC_DISABLE_AUTH;
    pretendDeployed();
    expect(isAuthDisabled()).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'off', 'no', ' false '])(
    'restores authentication when DISABLE_AUTH=%s, even off the runner',
    (value) => {
      pretendDeployed();
      env.DISABLE_AUTH = value;
      expect(isAuthDisabled()).toBe(false);
    },
  );

  it.each(['true', 'TRUE', '1', 'on', 'yes'])(
    'disables authentication when DISABLE_AUTH=%s, even under the runner',
    (value) => {
      env.DISABLE_AUTH = value;
      expect(isAuthDisabled()).toBe(true);
    },
  );

  it('honours the client-visible variable when the server-only one is unset', () => {
    delete env.DISABLE_AUTH;
    env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
    expect(isAuthDisabled()).toBe(true);
  });

  it('lets the server-only variable win, so the two halves cannot disagree', () => {
    env.DISABLE_AUTH = 'false';
    env.NEXT_PUBLIC_DISABLE_AUTH = 'true';
    expect(isAuthDisabled()).toBe(false);
  });
});

describe('preview claims', () => {
  it('take the role the calling screen asked for, not a fixed one', () => {
    // The substitution that lets one anonymous visitor open every console
    // instead of /ops/forbidden on all but one of them.
    expect(previewClaimsFor('depot').role).toBe('depot');
    expect(previewClaimsFor('pilot_driver').role).toBe('pilot_driver');
    expect(previewClaimsFor().role).toBe(PREVIEW_DEFAULT_ROLE);
  });

  it('borrow a real ops identity when one was found', () => {
    // `sub` is written into columns with an FK to ops_users(id); a borrowed
    // row is what keeps a preview's write paths from violating it.
    const claims = previewClaimsFor('dispatcher', { sub: 'real-id', email: 'ops@example.com' });
    expect(claims.sub).toBe('real-id');
    expect(claims.email).toBe('ops@example.com');
  });

  it('fall back to the synthetic identity when there is no ops database to read', () => {
    const claims = previewClaimsFor('planner');
    expect(claims.sub).toBe(PREVIEW_OPS_SUBJECT);
    expect(claims.email).toBe(PREVIEW_OPS_EMAIL);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });
});
