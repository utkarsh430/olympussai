// @vitest-environment node
//
// THE GUARD THAT STANDS BETWEEN CI AND THE CAPTAIN'S OWN LOGIN.
//
// CI now authenticates against the project's REAL Supabase directory — the
// same one that holds real people's accounts, including the owner's. It has
// to: `/login` is the single front door, and there is no second directory to
// point it at. And the ops end-to-end suite deliberately DISABLES accounts
// mid-render, because that race is the defect it exists to catch.
//
// So the failure this file is written against is not a red build. It is:
//
//     a pull request, from anyone, deletes or bans a real person's login.
//
// scripts/lib/qa-identity.mjs is the only path automation has to Supabase
// Auth, and it admits exactly one namespace: `*.qa@example.test`. `.test` is
// RFC 2606 reserved and can never be delegated, so nothing in that namespace
// can be a real mailbox. These tests are the proof that it REFUSES — every
// near-miss a plausible mistake or a hostile input could produce, and every
// entry point, including the ones that take no address at all.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  QA_IDENTITY_DOMAIN,
  QaNamespaceViolation,
  assertQaIdentity,
  isQaIdentityEmail,
  qaIdentityEmail,
  listQaIdentities,
  removeQaIdentities,
  upsertQaIdentity,
} from '../../../scripts/lib/qa-identity.mjs';

/** The address the whole guard exists to protect. */
const CAPTAINS_REAL_ACCOUNT = 'abhi121197@gmail.com';

describe('what the QA namespace admits', () => {
  it('admits the roster CI actually uses', () => {
    for (const email of [
      'admin.qa@example.test',
      'driver.qa@example.test',
      'pilot.driver.qa@example.test',
      'dispatcher.qa@example.test',
      'depot.qa@example.test',
      'control-room.qa@example.test',
      'planner.qa@example.test',
      // Run-scoped, which is the shape CI builds.
      'dispatcher.12345678-2.qa@example.test',
    ]) {
      expect(isQaIdentityEmail(email), email).toBe(true);
    }
  });

  it('folds case, because a directory listing may not be normalised', () => {
    expect(isQaIdentityEmail('Admin.QA@Example.Test')).toBe(true);
  });
});

describe('what it refuses', () => {
  it('refuses the account this guard exists for', () => {
    expect(isQaIdentityEmail(CAPTAINS_REAL_ACCOUNT)).toBe(false);
    expect(() => assertQaIdentity(CAPTAINS_REAL_ACCOUNT, 'delete')).toThrow(QaNamespaceViolation);
  });

  it.each([
    // Right domain, no `.qa` marker — an unrelated fixture address.
    ['someone@example.test'],
    ['qa@example.test'],
    // `.qa` in the wrong place.
    ['qa.admin@example.test'],
    ['admin.qa.ops@example.test'],
    // Lookalike domains. The first two are the ones a careless regex without
    // an end anchor lets straight through.
    ['admin.qa@example.test.evil.com'],
    ['admin.qa@example.testing.com'],
    ['admin.qa@example.tests'],
    ['admin.qa@exampletest'],
    ['admin.qa@sub.example.test'],
    ['admin.qa@EXAMPLE.TEST.attacker.io'],
    // Two addresses in one string: reads as in-namespace, delivers elsewhere.
    ['admin.qa@example.test@evil.com'],
    ['"admin.qa@example.test"@evil.com'],
    ['evil@attacker.io,admin.qa@example.test'],
    // Display-name wrapping, which is how a real address hides behind a fake.
    ['admin.qa@example.test <victim@real.com>'],
    ['QA <admin.qa@example.test>'],
    // Whitespace and control characters, including a header-injection shape.
    [' admin.qa@example.test'],
    ['admin.qa@example.test '],
    ['admin.qa@example.test\n'],
    ['admin.qa@example.test\r\nBcc: victim@real.com'],
    ['admin.qa@example .test'],
    // Plain real-world addresses.
    ['ops@olympuss.us'],
    ['someone@gmail.com'],
    [''],
  ])('refuses %j', (email) => {
    expect(isQaIdentityEmail(email)).toBe(false);
    expect(() => assertQaIdentity(email, 'delete a sign-in identity')).toThrow(
      QaNamespaceViolation,
    );
  });

  it('refuses non-strings without blowing up the predicate', () => {
    // `isQaIdentityEmail` filters a directory listing, where a malformed row
    // must answer "no", not throw and abandon the sweep half-done.
    for (const value of [null, undefined, 42, {}, [], Symbol('x')]) {
      expect(isQaIdentityEmail(value)).toBe(false);
    }
  });

  it('refuses rather than repairing', () => {
    // Trimming, unwrapping or otherwise "helpfully" normalising a rejected
    // address is exactly how `admin.qa@example.test <victim@real.com>`
    // becomes a delete. There is no sanitising entry point at all.
    expect(() => assertQaIdentity(' admin.qa@example.test ', 'delete')).toThrow(
      QaNamespaceViolation,
    );
  });

  it('names the address and the action it refused, so a red CI step explains itself', () => {
    try {
      assertQaIdentity(CAPTAINS_REAL_ACCOUNT, 'delete a sign-in identity');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(QaNamespaceViolation);
      expect((error as Error).message).toContain(CAPTAINS_REAL_ACCOUNT);
      expect((error as Error).message).toContain('delete a sign-in identity');
      expect((error as Error).message).toContain(QA_IDENTITY_DOMAIN);
    }
  });
});

describe('the address builder cannot be talked out of the namespace', () => {
  it('builds an in-namespace address from a role and a run scope', () => {
    expect(qaIdentityEmail('dispatcher', '12345678-2')).toBe(
      'dispatcher.12345678-2.qa@example.test',
    );
  });

  it('gives concurrent runs different addresses', () => {
    // Two pull requests running this workflow at once must not name the same
    // identity: the second `createUser` would collide, and the first
    // teardown would delete the second run's fixtures mid-suite.
    expect(qaIdentityEmail('admin', 'run-1')).not.toBe(qaIdentityEmail('admin', 'run-2'));
  });

  it.each([
    ['admin@evil.com', 'scope'],
    ['admin', 'scope@evil.com'],
    ['admin', 'x\n@evil.com'],
    ['../../admin', 'scope'],
  ])('cannot be steered out of the namespace by %j / %j', (label, scope) => {
    expect(isQaIdentityEmail(qaIdentityEmail(label, scope))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE OPERATIONS THEMSELVES
// ───────────────────────────────────────────────────────────────────────────

/** Any admin call: only the slice `scripts/lib/qa-identity.mjs` reaches. */
type FakeAdminCall = (...args: never[]) => Promise<{ data?: unknown; error?: unknown }>;

/**
 * A Supabase admin API that records what it was ASKED to do and refuses
 * nothing, so any call that escapes the guard shows up here as evidence
 * rather than being masked by the real API's own validation.
 */
function fakeSupabase(users: Array<{ id: string; email: string; created_at?: string }> = []) {
  const calls = { created: [] as string[], updated: [] as string[], deleted: [] as string[] };
  const admin: { auth: { admin: Record<string, FakeAdminCall> } } = {
    auth: {
      admin: {
        createUser: vi.fn(async ({ email }: { email: string }) => {
          calls.created.push(email);
          return {
            data: { user: { id: `new-${email}`, app_metadata: { ops_role: 'driver' } } },
            error: null,
          };
        }),
        updateUserById: vi.fn(async (id: string) => {
          calls.updated.push(id);
          return { data: { user: { id, app_metadata: { ops_role: 'driver' } } }, error: null };
        }),
        deleteUser: vi.fn(async (id: string) => {
          calls.deleted.push(id);
          const index = users.findIndex((user) => user.id === id);
          if (index >= 0) users.splice(index, 1);
          return { error: null };
        }),
        getUserById: vi.fn(async (id: string) => {
          const user = users.find((candidate) => candidate.id === id);
          return user ? { data: { user }, error: null } : { data: null, error: { message: 'gone' } };
        }),
        listUsers: vi.fn(async ({ page }: { page: number }) => ({
          data: { users: page === 1 ? [...users] : [] },
          error: null,
        })),
      },
    },
  };
  // The real functions want a SupabaseClient; only `auth.admin` is ever
  // reached, so the cast is the honest way to say "this stands in for the
  // slice under test" rather than stubbing twenty-five unused properties.
  return { admin: admin as unknown as SupabaseClient, raw: admin, calls, users };
}

describe('creating an identity', () => {
  it('refuses an address outside the namespace before touching Supabase at all', async () => {
    const { admin, calls } = fakeSupabase();

    await expect(
      upsertQaIdentity(admin, {
        email: CAPTAINS_REAL_ACCOUNT,
        password: 'x'.repeat(16),
        opsRole: 'admin',
      }),
    ).rejects.toBeInstanceOf(QaNamespaceViolation);

    // Not "the API said no" — the API was never called. That is the
    // difference between a guard and a hope.
    expect(calls.created).toEqual([]);
    expect(calls.updated).toEqual([]);
  });

  it('creates one inside the namespace', async () => {
    const { admin, calls } = fakeSupabase();

    await upsertQaIdentity(admin, {
      email: 'driver.qa@example.test',
      password: 'x'.repeat(16),
      opsRole: 'driver',
    });

    expect(calls.created).toEqual(['driver.qa@example.test']);
  });
});

describe('deleting identities', () => {
  it('takes no address from its caller, so it cannot be aimed at anything', async () => {
    // The structural half of the guarantee. `removeQaIdentities` lists the
    // directory itself and filters; `scope` and `olderThanMs` only NARROW
    // what it found. There is no option through which a caller — or a future
    // edit that copies this call shape — can name a target, so every one of
    // these is inert.
    const { admin, calls } = fakeSupabase([
      { id: 'real-1', email: CAPTAINS_REAL_ACCOUNT },
      { id: 'real-2', email: 'ops@olympuss.us' },
    ]);

    const result = await removeQaIdentities(admin, {
      email: CAPTAINS_REAL_ACCOUNT,
      emails: [CAPTAINS_REAL_ACCOUNT, 'ops@olympuss.us'],
      id: 'real-1',
      ids: ['real-1', 'real-2'],
      include: /.*/,
      all: true,
    } as never);

    expect(calls.deleted).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('leaves every non-QA account in the directory untouched', async () => {
    const { admin, calls, users } = fakeSupabase([
      { id: 'real-1', email: CAPTAINS_REAL_ACCOUNT },
      { id: 'real-2', email: 'ops@olympuss.us' },
      { id: 'lookalike', email: 'admin.qa@example.test.evil.com' },
      { id: 'qa-1', email: 'driver.qa@example.test' },
      { id: 'qa-2', email: 'admin.qa@example.test' },
    ]);

    const result = await removeQaIdentities(admin);

    expect(calls.deleted.sort()).toEqual(['qa-1', 'qa-2']);
    expect(result.deleted.sort()).toEqual(['admin.qa@example.test', 'driver.qa@example.test']);
    expect(users.map((user) => user.email).sort()).toEqual([
      CAPTAINS_REAL_ACCOUNT,
      'admin.qa@example.test.evil.com',
      'ops@olympuss.us',
    ]);
  });

  it('refuses to delete a record whose address changed since the listing', async () => {
    // The list/delete race: the id was in-namespace when it was listed and
    // is not by the time it is deleted. Re-reading and re-asserting is what
    // makes a stale listing unable to become a deletion.
    const { admin, raw, calls } = fakeSupabase([{ id: 'qa-1', email: 'driver.qa@example.test' }]);
    raw.auth.admin.getUserById = vi.fn(async () => ({
      data: { user: { id: 'qa-1', email: CAPTAINS_REAL_ACCOUNT } },
      error: null,
    }));

    const result = await removeQaIdentities(admin);

    expect(calls.deleted).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.failed).toHaveLength(1);
  });

  it('narrows to one run when given a scope, so concurrent runs cannot reap each other', async () => {
    const { admin, calls } = fakeSupabase([
      { id: 'mine', email: 'driver.run-a.qa@example.test' },
      { id: 'theirs', email: 'driver.run-b.qa@example.test' },
    ]);

    await removeQaIdentities(admin, { scope: 'run-a' });

    expect(calls.deleted).toEqual(['mine']);
  });

  it('keeps an identity whose age cannot be read, rather than guessing it is stale', async () => {
    const { admin, calls } = fakeSupabase([
      { id: 'unreadable', email: 'driver.qa@example.test', created_at: 'not-a-date' },
      { id: 'old', email: 'admin.qa@example.test', created_at: new Date(0).toISOString() },
    ]);

    await removeQaIdentities(admin, { olderThanMs: 60_000 });

    expect(calls.deleted).toEqual(['old']);
  });

  it('reports what it failed to remove instead of claiming success', async () => {
    // A teardown that says "done" while leaving accounts behind is how a
    // shared directory silently fills with logins the next run collides with.
    const { admin, raw } = fakeSupabase([{ id: 'qa-1', email: 'driver.qa@example.test' }]);
    raw.auth.admin.deleteUser = vi.fn(async () => ({ error: { message: 'nope' } }));

    const result = await removeQaIdentities(admin);

    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([{ email: 'driver.qa@example.test', reason: 'nope' }]);
    expect(result.remaining).toEqual(['driver.qa@example.test']);
  });

  it('verifies removal against the directory, not against the absence of errors', async () => {
    // A delete that returns 200 and does nothing must not read as success.
    const { admin, raw } = fakeSupabase([{ id: 'qa-1', email: 'driver.qa@example.test' }]);
    raw.auth.admin.deleteUser = vi.fn(async () => ({ error: null }));

    const result = await removeQaIdentities(admin);

    expect(result.deleted).toEqual(['driver.qa@example.test']);
    expect(result.remaining).toEqual(['driver.qa@example.test']);
  });
});

describe('the directory listing', () => {
  it('pages, so QA identities past the first page are not left behind forever', async () => {
    const pages = [
      Array.from({ length: 200 }, (_, i) => ({ id: `p1-${i}`, email: `real${i}@olympuss.us` })),
      [{ id: 'p2-0', email: 'driver.qa@example.test' }],
    ];
    const admin = {
      auth: {
        admin: {
          listUsers: vi.fn(async ({ page }: { page: number }) => ({
            data: { users: pages[page - 1] ?? [] },
            error: null,
          })),
        },
      },
    } as unknown as SupabaseClient;

    const found = await listQaIdentities(admin);

    expect(found.map((user: { email: string }) => user.email)).toEqual([
      'driver.qa@example.test',
    ]);
  });
});
