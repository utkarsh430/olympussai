// @vitest-environment node
//
// The race that made every ops dashboard answer a routine admin action with
// HTTP 500, and the outage that used to look like a sign-out.
//
// ─── WHAT BROKE ──────────────────────────────────────────────────────────
//
// Every ops page did this, under a comment explaining why it was safe:
//
//     const session = (await getOpsSession())!;   // the layout guard proved
//                                                 // this is non-null
//
// It WAS safe, while `getOpsSession()` was a pure token decode: deterministic,
// no I/O, so the layout guard and the page body could not disagree. Collapsing
// the two auth systems turned it into a read of `ops_users` on every call, and
// the App Router renders a layout and its page CONCURRENTLY. That is two
// independent reads of a table an admin can change at any moment. Disable an
// operator (or change their role) while they are loading a dashboard and the
// two reads land on opposite sides of the write: the guard redirects, the body
// carries on with null, and `!` becomes
// `TypeError: Cannot read properties of null (reading 'sub')` — an unhandled
// 500 on all twelve ops pages, reproduced at ~1-6% of requests under a
// concurrent load with the account being toggled.
//
// Two things fix it, and the tests below hold both, because either alone is
// insufficient:
//
//   1. `resolveOpsSession` is memoised per request (React `cache`), so a
//      render has ONE answer instead of two racing ones. Not assertable here
//      — `cache()` only memoises inside a request scope, and there is none in
//      a unit test — so the structural test at the bottom pins it in source
//      and the concurrent-load harness proves it in the real runtime.
//   2. No caller asserts a session away. Pages take theirs from the guard,
//      which redirects on refusal. That IS assertable, and is what the bulk of
//      this file holds.
//
// ─── AND THE FAILURE MODE UNDERNEATH IT ──────────────────────────────────
//
// A transient ops-database failure used to be indistinguishable from being
// signed out: the resolver collapsed everything into null. On an operations
// console that is the wrong answer twice — it blames the person on shift for a
// service problem, and it sends them to a sign-in flow that reads the very
// authority that is down. `unavailable` is now its own refusal with its own
// destination and its own status code.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { OpsUserRecord } from '@/lib/auth/rbac/repo';
import type { OpsRole } from '@/lib/auth/rbac/roles';

const findUserBySupabaseId = vi.fn<(id: string) => Promise<OpsUserRecord | null>>();
const findUserById = vi.fn<(id: string) => Promise<OpsUserRecord | null>>();
const cookieGet = vi.fn<(name: string) => { value: string } | undefined>();

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock('@/lib/auth/rbac/supabaseClaims', () => ({
  readSupabaseOpsClaim: async () => null,
  OPS_ROLE_CLAIM: 'ops_role',
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({}),
}));
vi.mock('@/lib/auth/rbac/repo', () => ({
  getOpsRepo: () => ({
    findUserBySupabaseId: (id: string) => findUserBySupabaseId(id),
    findUserById: (id: string) => findUserById(id),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));
// Partial: `redirect` becomes a catchable signal so a guard's refusal can be
// read, but `unstable_rethrow` must be the REAL one. Stubbing it would make
// the control-flow-rethrow test below assert against a stub of the very thing
// under test.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

const { resolveOpsSession, getOpsSession } = await import('@/lib/auth/rbac/server');
const { requireOpsRolePage, OPS_UNAVAILABLE_PATH } = await import('@/lib/auth/rbac/pageGuard');
const { requireOpsRole, requireOpsSession } = await import('@/lib/auth/rbac/guard');
const { createOpsSessionToken } = await import('@/lib/auth/rbac/session');
const { OPS_SESSION_COOKIE } = await import('@/lib/auth/rbac/config');

const OPS_USER_ID = '11111111-1111-1111-1111-111111111111';

function profile(overrides: Partial<OpsUserRecord> = {}): OpsUserRecord {
  return {
    id: OPS_USER_ID,
    email: 'driver@olympuss.local',
    name: 'A Driver',
    role: 'driver',
    passwordHash: '$2a$10$notarealhash',
    status: 'active',
    vehicleId: null,
    depotId: null,
    supabaseUserId: null,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

async function signedIn(role: OpsRole): Promise<void> {
  const token = await createOpsSessionToken({ id: OPS_USER_ID, email: 'driver@olympuss.local', role });
  cookieGet.mockImplementation((name) =>
    name === OPS_SESSION_COOKIE ? { value: token } : undefined,
  );
}

/** Runs the guard and reports where it sent the caller, or what it returned. */
async function guardPage(
  role: OpsRole,
  nextPath: string,
): Promise<{ redirectedTo: string | null; claims: unknown }> {
  try {
    return { redirectedTo: null, claims: await requireOpsRolePage(role, nextPath) };
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirectedTo: error.to, claims: null };
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // The resolver logs an unreadable authority on purpose (an operations
  // console must not degrade silently). Swallowed here so a suite that is
  // deliberately provoking it stays readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.OPS_SESSION_SECRET = 'e'.repeat(40);
  findUserBySupabaseId.mockResolvedValue(null);
  findUserById.mockResolvedValue(null);
  cookieGet.mockReturnValue(undefined);
});

// ───────────────────────────────────────────────────────────────────────────
// THE 500
// ───────────────────────────────────────────────────────────────────────────

describe('a session that vanishes mid-render redirects instead of crashing', () => {
  it('hands the page its session, so the page never re-resolves one to assert on', async () => {
    await signedIn('driver');
    findUserById.mockResolvedValue(profile());

    const { redirectedTo, claims } = await guardPage('driver', '/ops/driver');

    expect(redirectedTo).toBeNull();
    // The value the page renders with comes from the guard that admitted it.
    // That single fact is what removes the second, racing resolution.
    expect(claims).toMatchObject({ sub: OPS_USER_ID, role: 'driver' });
  });

  it('redirects — never throws — when the account is disabled between guard and body', async () => {
    // The exact reproduction: the guard admitted the request, and by the time
    // the page body resolves, an admin has disabled the account.
    await signedIn('driver');
    findUserById.mockResolvedValue(profile({ status: 'disabled' }));

    const { redirectedTo } = await guardPage('driver', '/ops/driver');

    expect(redirectedTo).toBe('/ops/login?next=%2Fops%2Fdriver');
  });

  it('redirects when the role changes under it, rather than rendering another role screen', async () => {
    await signedIn('driver');
    findUserById.mockResolvedValue(profile({ role: 'dispatcher' }));

    // The claim says driver, the database now says dispatcher: refused as a
    // stale session, repaired by signing in again.
    const { redirectedTo } = await guardPage('driver', '/ops/driver');

    expect(redirectedTo).toBe('/ops/login?next=%2Fops%2Fdriver');
  });

  it('sends a genuinely wrong-role operator to forbidden, not back to sign-in', async () => {
    await signedIn('dispatcher');
    findUserById.mockResolvedValue(profile({ role: 'dispatcher' }));

    const { redirectedTo } = await guardPage('driver', '/ops/driver');

    expect(redirectedTo).toBe('/ops/forbidden');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// OUTAGE vs SIGNED OUT
// ───────────────────────────────────────────────────────────────────────────

describe('an unreadable ops database is not a signed-out user', () => {
  it('reports its own reason instead of throwing a 500 or claiming no session', async () => {
    await signedIn('driver');
    findUserById.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const resolution = await resolveOpsSession();

    expect(resolution).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('never becomes access — the token role is not promoted to fill the gap', async () => {
    await signedIn('control_room');
    findUserById.mockRejectedValue(new Error('connect ECONNREFUSED'));

    // The token says control_room. If an outage ever answered from it, a
    // disabled account would work again for the length of the outage.
    expect(await getOpsSession()).toBeNull();
    const guard = await requireOpsRole(['control_room']);
    expect(guard.ok).toBe(false);
  });

  it('sends an operator to an explanation, not to a sign-in page that cannot help', async () => {
    await signedIn('driver');
    findUserById.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const { redirectedTo } = await guardPage('driver', '/ops/driver');

    expect(redirectedTo).toBe(`${OPS_UNAVAILABLE_PATH}?next=%2Fops%2Fdriver`);
    expect(redirectedTo).not.toContain('/ops/login');
  });

  it('answers an ops API with 503, not the 401 that means "your credentials"', async () => {
    await signedIn('driver');
    findUserById.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const guard = await requireOpsSession();

    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(503);
    expect(await guard.response.json()).toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
  });

  it('still answers 401 for the refusals that really are about the caller', async () => {
    await signedIn('driver');
    findUserById.mockResolvedValue(null);

    const guard = await requireOpsSession();

    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(401);
  });

  it('does not send a signed-out visitor to the outage page', async () => {
    // No cookie, no Supabase session, database perfectly healthy.
    const { redirectedTo } = await guardPage('driver', '/ops/driver');

    expect(redirectedTo).toBe('/ops/login?next=%2Fops%2Fdriver');
  });

  it("rethrows Next's own control-flow errors instead of reporting them as an outage", async () => {
    // A regression with teeth. `redirect()`, `notFound()` and the
    // dynamic-rendering bailout are all signalled AS thrown errors, so the
    // catch that turns a database failure into `unavailable` will swallow
    // them unless it rethrows first. Swallowing the bailout tells Next a page
    // that reads cookies can be prerendered, and turns "this page is dynamic"
    // into "the operations directory is down" — a build failure, or worse a
    // build success, with a completely misleading cause.
    await signedIn('driver');
    const notFoundError = Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), {
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    findUserById.mockRejectedValue(notFoundError);

    await expect(resolveOpsSession()).rejects.toBe(notFoundError);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE STRUCTURAL GUARD
// ───────────────────────────────────────────────────────────────────────────

/**
 * The behavioural tests above prove the guard is correct. They cannot prove
 * that all twelve pages USE it — and "eleven of them were converted" is
 * exactly the shape this defect had, since only /ops/pilot-driver has any
 * end-to-end coverage at all. So this walks the App Router directory itself.
 */
describe('no ops page resolves its own session to assert on', () => {
  const opsRoot = path.join(process.cwd(), 'src/app/(ops)/ops');

  function pageFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return pageFiles(full);
      return entry.name === 'page.tsx' ? [full] : [];
    });
  }

  const pages = pageFiles(opsRoot);
  // Public ops pages: they have no role to require and must keep rendering
  // when everything else is refusing.
  const PUBLIC_PAGES = ['login', 'forbidden', 'accept-invite', 'unavailable'];
  const guarded = pages.filter(
    (file) => !PUBLIC_PAGES.some((name) => file.includes(`${path.sep}${name}${path.sep}`)),
  );

  it('found every guarded ops page (a move must not silently shrink this set)', () => {
    expect(guarded.length).toBe(12);
  });

  it.each(guarded)('%s takes its session from the guard', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain('requireOpsRolePage(');
  });

  it.each(guarded)('%s never asserts a session non-null', (file) => {
    const source = fs.readFileSync(file, 'utf8');
    // The literal shape of the defect, plus the general "assert away whatever
    // getOpsSession returned" form.
    expect(source).not.toMatch(/await\s+getOpsSession\(\)\s*\)\s*!/);
    expect(source).not.toMatch(/getOpsSession/);
  });

  it('resolves the session once per request, not once per caller', () => {
    // React `cache()` only memoises inside a request scope, so this cannot be
    // executed here; it is pinned in source instead, and measured for real by
    // the concurrent-load harness (a guarded page render dropped from two
    // ops_users session reads to one). Losing the wrapper reinstates the two
    // independent reads this whole file exists because of.
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/auth/rbac/server.ts'),
      'utf8',
    );
    expect(source).toMatch(/import \{ cache \} from 'react'/);
    expect(source).toMatch(/cache\(resolveOpsSessionUncached\)/);
  });
});
