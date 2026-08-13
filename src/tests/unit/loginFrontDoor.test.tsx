// @vitest-environment jsdom
//
// /login as the single front door: role-correct landing, the no-ops-access
// terminal state, and the redirect loop that would otherwise lock everybody
// out of the product.
//
// THE LOOP IS THE POINT OF THIS FILE. It is reachable with no bug anywhere
// in it — every hop is individually correct:
//
//   /ops/depot        middleware finds no usable role ceiling on the token
//     -> /ops/login?next=/ops/depot          (middleware's own bounce URL)
//     -> /login?next=/ops/depot              (the login collapse)
//     -> "you're signed in, go to your dashboard"
//     -> /ops/depot                          ... forever.
//
// And it is not hypothetical during this cutover: until the backfill writes
// `app_metadata.ops_role`, EVERY Supabase session reaches ops middleware with
// no role claim at all, so the first hop fires for everyone. A user cannot
// tell an infinite redirect from a dead product, and cannot get out of one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';

import { resolveLanding, opsHomePath, landingUrl, NO_OPS_ACCESS_NOTICE, OPS_ACCESS_PENDING_NOTICE, OPS_LEGACY_LOGIN_PATH } from '@/lib/auth/landing';
import { sanitizeNext, sanitizeNextOrNull, DEFAULT_NEXT } from '@/lib/auth/redirect';
import { OPS_ROLES, type OpsRole } from '@/lib/auth/rbac/roles';

// ── Test doubles for the two server reads the pages make. ─────────────────
// `redirect()` really does throw in Next (that is how it unwinds a Server
// Component), so the stub throws a tagged error and the helpers below turn it
// back into a destination. A page that *renders* never throws — which is
// exactly the distinction every loop assertion here turns on.
class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

const getSupabaseUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseUser: () => getSupabaseUser(),
}));

const currentOpsRole = vi.fn();
/**
 * Whether the caller's TOKEN carries the role their `ops_users` row holds.
 *
 * The same fact `hasEdgeCeiling` models below, seen from the Node side —
 * `walk()` keeps the two in step deliberately, because a test where the edge
 * gate and the sign-in page disagree about the same token is testing a
 * situation that cannot happen and would hide the one that can.
 */
const opsClaimReady = vi.fn<() => boolean>();
vi.mock('@/lib/auth/opsAccess', () => ({
  currentOpsRole: () => currentOpsRole(),
  currentOpsAccess: async () => ({
    role: await currentOpsRole(),
    claimReady: opsClaimReady(),
  }),
  opsRoleForSupabaseUser: vi.fn(),
}));

const getOpsSession = vi.fn();
vi.mock('@/lib/auth/rbac/server', () => ({
  getOpsSession: () => getOpsSession(),
}));

import LoginPage from '@/app/(public)/login/page';
import OpsLoginPage from '@/app/(ops)/ops/login/page';
import { LoginForm } from '@/components/auth/LoginForm';

/** Visit a page component. Returns where it redirected, or its rendered tree. */
async function visit(
  Page: (props: { searchParams: Promise<Record<string, string | undefined>> }) => Promise<unknown>,
  params: Record<string, string | undefined> = {},
): Promise<{ redirectedTo: string | null; element: unknown }> {
  try {
    const element = await Page({ searchParams: Promise.resolve(params) });
    return { redirectedTo: null, element };
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirectedTo: error.to, element: null };
    throw error;
  }
}

function parse(url: string): { pathname: string; params: Record<string, string> } {
  const parsed = new URL(url, 'https://olympuss.test');
  return {
    pathname: parsed.pathname,
    params: Object.fromEntries(parsed.searchParams.entries()),
  };
}

beforeEach(() => {
  getSupabaseUser.mockReset().mockResolvedValue(null);
  currentOpsRole.mockReset().mockResolvedValue(null);
  opsClaimReady.mockReset().mockReturnValue(true);
  getOpsSession.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ───────────────────────────────────────────────────────────────────────────
// THE LOOP
// ───────────────────────────────────────────────────────────────────────────

describe('redirect loop safety', () => {
  /**
   * Middleware's half of the cycle, modelled.
   *
   * It cannot be executed here — it is Edge-runtime code whose whole job is
   * to verify a real signed token — so this reproduces the one branch that
   * closes the loop: an ops path with no usable role ceiling is bounced to
   * `/ops/login` carrying the original path as `next`. `middlewareBounceUrl`
   * below pins that shape against the actual source, so if middleware ever
   * stops building this URL the model fails loudly instead of quietly
   * testing a cycle the product no longer has.
   *
   * `hasEdgeCeiling: false` is not a pessimistic hypothetical — it is the
   * state of EVERY Supabase session until the backfill writes
   * `app_metadata.ops_role`, including one belonging to a fully provisioned
   * operator. That is why the cutover is where this loop bites.
   */
  function middlewareBounce(pathname: string, search: string): string {
    const url = new URL('/ops/login', 'https://olympuss.test');
    url.searchParams.set('next', `${pathname}${search}`);
    return `${url.pathname}?${url.searchParams.toString()}`;
  }

  /**
   * Walks the real page components hop by hop from a starting URL, failing
   * the moment any URL is visited twice. It does not care *which* rule breaks
   * the cycle, only that the product always reaches a page a human can act on.
   */
  async function walk(
    start: string,
    { hasEdgeCeiling }: { hasEdgeCeiling: boolean },
    maxHops = 12,
  ): Promise<string[]> {
    const seen: string[] = [];
    let url = start;

    // One token, one fact. "Middleware has no ceiling" and "the sign-in page
    // can see no role claim" are the same missing claim, so the model must
    // not let them disagree.
    opsClaimReady.mockReturnValue(hasEdgeCeiling);

    for (let hop = 0; hop < maxHops; hop += 1) {
      expect(seen, `redirect loop: ${[...seen, url].join(' -> ')}`).not.toContain(url);
      seen.push(url);

      const { pathname, params } = parse(url);
      const search = url.includes('?') ? `?${url.split('?')[1]}` : '';

      if (pathname === '/login') {
        const { redirectedTo } = await visit(LoginPage, params);
        if (redirectedTo === null) return [...seen]; // rendered — terminal.
        url = redirectedTo;
        continue;
      }

      if (pathname === '/ops/login') {
        const { redirectedTo } = await visit(OpsLoginPage, params);
        if (redirectedTo === null) return [...seen];
        url = redirectedTo;
        continue;
      }

      if (pathname.startsWith('/ops/')) {
        // Middleware's gate. Without a ceiling it bounces straight back to
        // the sign-in surface — the other half of the cycle.
        if (!hasEdgeCeiling) {
          url = middlewareBounce(pathname, search);
          continue;
        }
        return [...seen]; // reached the dashboard.
      }

      return [...seen]; // left our surface (the project). Terminal.
    }

    throw new Error(`did not settle within ${maxHops} hops: ${seen.join(' -> ')}`);
  }

  it('middleware really does build the bounce this models', () => {
    // Pins the coupling above. If middleware stops sending refusals to
    // /ops/login with a `next`, the loop model is fiction and must be redone.
    const source = fs.readFileSync(path.join(process.cwd(), 'src/middleware.ts'), 'utf8');
    expect(source).toContain("new URL('/ops/login', request.url)");
    expect(source).toContain("loginUrl.searchParams.set('next'");
  });

  it('settles for a signed-in user with NO ops profile bounced off an ops screen', async () => {
    // A real Supabase session, no linked ops_users row, bounced off
    // /ops/depot. Before the collapse this input cycles forever.
    getSupabaseUser.mockResolvedValue({ email: 'viewer@example.com' });
    currentOpsRole.mockResolvedValue(null);

    const trail = await walk('/ops/depot', { hasEdgeCeiling: false });

    // It must END on /login, rendered — not on an ops path it cannot open.
    expect(trail.at(-1)).toMatch(/^\/login\b/);
  });

  it('settles for a provisioned operator whose token carries no role claim yet', async () => {
    // THE CUTOVER CASE. The database says depot; the token says nothing, so
    // middleware has no ceiling and bounces. Every account is in this state
    // until the backfill runs, so this is the ordinary path, not an edge one.
    getSupabaseUser.mockResolvedValue({ email: 'depot@example.com' });
    currentOpsRole.mockResolvedValue('depot' satisfies OpsRole);

    const trail = await walk('/ops/depot', { hasEdgeCeiling: false });
    expect(trail.at(-1)).toMatch(/^\/login\b/);
  });

  it('lets a fully provisioned operator through to their dashboard', async () => {
    // The post-backfill state: the loop must not have been prevented by
    // simply refusing to ever route anyone into /ops/*.
    getSupabaseUser.mockResolvedValue({ email: 'depot@example.com' });
    currentOpsRole.mockResolvedValue('depot' satisfies OpsRole);

    const trail = await walk('/ops/depot', { hasEdgeCeiling: true });
    expect(trail).toEqual(['/ops/depot']);
  });

  it('settles for an anonymous visitor', async () => {
    const trail = await walk('/ops/control-room', { hasEdgeCeiling: false });
    expect(trail.at(-1)).toMatch(/^\/login\b/);
  });

  it('settles when the bounce points back at a login page', async () => {
    // ?next=/ops/login is a one-hop loop all by itself.
    getSupabaseUser.mockResolvedValue({ email: 'viewer@example.com' });
    await expect(walk('/ops/login?next=%2Fops%2Flogin', { hasEdgeCeiling: false })).resolves.toBeTruthy();
    await expect(walk('/login?next=%2Fops%2Flogin', { hasEdgeCeiling: false })).resolves.toBeTruthy();
  });

  it('/login NEVER redirects, whatever it is handed', async () => {
    // The load-bearing rule. A cycle needs an automatic hop at every step;
    // this page renders instead, so it is always a terminal state — even for
    // a bounce reason this code cannot see (a missing role claim, say).
    const inputs: Record<string, string | undefined>[] = [
      {},
      { next: '/ops/depot' },
      { next: '/ops/admin' },
      { next: '/project/upsrtc' },
      { next: 'https://evil.example.com' },
      { next: '//evil.example.com' },
      { notice: NO_OPS_ACCESS_NOTICE },
      { next: '/ops/depot', notice: NO_OPS_ACCESS_NOTICE },
    ];

    for (const signedIn of [null, { email: 'a@example.com' }]) {
      for (const role of [null, 'depot', 'admin'] as (OpsRole | null)[]) {
        getSupabaseUser.mockResolvedValue(signedIn);
        currentOpsRole.mockResolvedValue(role);
        for (const params of inputs) {
          const { redirectedTo } = await visit(LoginPage, params);
          expect(
            redirectedTo,
            `/login redirected to ${redirectedTo} for ${JSON.stringify({ signedIn, role, params })}`,
          ).toBeNull();
        }
      }
    }
  });

  it('refuses to nominate an ops destination for someone who cannot open one', async () => {
    // Second, independent guard: even if /login ever did redirect, the
    // decision itself never names an /ops/* path without a usable profile.
    for (const requestedNext of ['/ops/depot', '/ops/admin/invites', '/ops/control-room']) {
      expect(resolveLanding({ requestedNext, opsRole: null })).toEqual({
        kind: 'no-ops-access',
        requested: requestedNext,
      });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ROLE-CORRECT LANDING
// ───────────────────────────────────────────────────────────────────────────

describe('role-correct landing', () => {
  it('sends each of the seven roles to its own dashboard', () => {
    const homes = Object.fromEntries(OPS_ROLES.map((role) => [role, opsHomePath(role)]));
    expect(homes).toEqual({
      driver: '/ops/driver',
      pilot_driver: '/ops/pilot-driver',
      dispatcher: '/ops/dispatcher',
      depot: '/ops/depot',
      control_room: '/ops/control-room',
      planner: '/ops/planner',
      admin: '/ops/admin/invites',
    });
  });

  it('every role home is a page that actually exists', () => {
    // /ops/admin was a real 404 for every admin who signed in, accepted an
    // invite, or followed "back to your dashboard" off /ops/forbidden — the
    // segment map is a URL vocabulary, not a claim that a page is there.
    // Walking the App Router means a future route move cannot quietly
    // reintroduce this for a different role.
    const appRoot = path.join(process.cwd(), 'src/app/(ops)');
    for (const role of OPS_ROLES) {
      const home = opsHomePath(role);
      const pageFile = path.join(appRoot, home, 'page.tsx');
      expect(fs.existsSync(pageFile), `${role} lands on ${home}, but ${pageFile} does not exist`).toBe(true);
    }
  });

  it('honours an explicit ops deep link over the role home', () => {
    expect(resolveLanding({ requestedNext: '/ops/control-room/incidents/42', opsRole: 'control_room' })).toEqual({
      kind: 'go',
      path: '/ops/control-room/incidents/42',
    });
  });

  it('falls back to the role home when nothing was requested', () => {
    expect(resolveLanding({ requestedNext: null, opsRole: 'planner' })).toEqual({
      kind: 'go',
      path: '/ops/planner',
    });
    expect(resolveLanding({ requestedNext: undefined, opsRole: 'admin' })).toEqual({
      kind: 'go',
      path: '/ops/admin/invites',
    });
  });

  it('sends a non-ops user to the project, as before', () => {
    expect(resolveLanding({ requestedNext: null, opsRole: null })).toEqual({
      kind: 'go',
      path: DEFAULT_NEXT,
    });
    expect(resolveLanding({ requestedNext: '/project/bunching', opsRole: null })).toEqual({
      kind: 'go',
      path: '/project/bunching',
    });
  });

  it('never lets a hostile next escape, whatever the role', () => {
    for (const hostile of [
      'https://evil.example.com/steal',
      '//evil.example.com',
      '/\\evil.example.com',
      'javascript:alert(1)',
      '/ops',
      '/admin',
    ]) {
      const decision = resolveLanding({ requestedNext: hostile, opsRole: 'depot' });
      // Falls through to the role home — never off-site, never the raw value.
      expect(decision).toEqual({ kind: 'go', path: '/ops/depot' });
    }
  });

  it('routes a no-ops-access decision back to /login, not into ops', () => {
    const decision = resolveLanding({ requestedNext: '/ops/depot', opsRole: null });
    expect(landingUrl(decision)).toBe(`/login?notice=${NO_OPS_ACCESS_NOTICE}`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE ALLOWLIST WIDENING
// ───────────────────────────────────────────────────────────────────────────

describe('sanitizeNext now carries ops deep links', () => {
  it('keeps an ops path instead of silently dropping it on the project', () => {
    // The one-line omission the auth-core worker flagged: without this,
    // EVERY ops deep link lands on /project/upsrtc with no error at all —
    // a wrong-product landing that no test and no user would ever report as
    // a redirect failure.
    expect(sanitizeNext('/ops/depot')).toBe('/ops/depot');
    expect(sanitizeNext('/ops/control-room/incidents/7')).toBe('/ops/control-room/incidents/7');
    expect(sanitizeNext('/ops/admin/invites')).toBe('/ops/admin/invites');
  });

  it('still rejects the login pages themselves (no redirect loop)', () => {
    expect(sanitizeNextOrNull('/ops/login')).toBeNull();
    expect(sanitizeNextOrNull('/ops/login?next=/ops/depot')).toBeNull();
    expect(sanitizeNextOrNull('/ops/accept-invite?token=x')).toBeNull();
    expect(sanitizeNext('/ops/login')).toBe(DEFAULT_NEXT);
  });

  it('still rejects everything off-site', () => {
    for (const hostile of [
      'https://evil.example.com',
      '//evil.example.com',
      '/\\evil.example.com',
      'ops/depot',
      '/opsfake/depot',
      '/api/ops/depot',
    ]) {
      expect(sanitizeNextOrNull(hostile), hostile).toBeNull();
    }
  });

  it('still carries the project surfaces it always did', () => {
    expect(sanitizeNext('/project/upsrtc')).toBe('/project/upsrtc');
    expect(sanitizeNext('/project/bunching/scenario/3')).toBe('/project/bunching/scenario/3');
    expect(sanitizeNext(null)).toBe(DEFAULT_NEXT);
  });

  it('distinguishes "asked for nothing" from "asked for the default"', () => {
    // resolveLanding needs the difference: no request falls through to the
    // role home, whereas an explicit /project/upsrtc is honoured as asked.
    expect(sanitizeNextOrNull(null)).toBeNull();
    expect(sanitizeNextOrNull('/project/upsrtc')).toBe('/project/upsrtc');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// /ops/login FORWARDS BUT IS NOT GONE
// ───────────────────────────────────────────────────────────────────────────

describe('/ops/login', () => {
  it('forwards to the single front door', async () => {
    const { redirectedTo } = await visit(OpsLoginPage, {});
    expect(redirectedTo).toBe('/login');
  });

  it('carries a safe next through the forward', async () => {
    const { redirectedTo } = await visit(OpsLoginPage, { next: '/ops/control-room/incidents/9' });
    expect(redirectedTo).toBe('/login?next=%2Fops%2Fcontrol-room%2Fincidents%2F9');
  });

  it('drops an unsafe or self-referential next rather than forwarding it', async () => {
    for (const next of ['https://evil.example.com', '/ops/login', '/project/upsrtc']) {
      const { redirectedTo } = await visit(OpsLoginPage, { next });
      expect(redirectedTo, next).toBe('/login');
    }
  });

  it('does not read the ops database just to forward', async () => {
    // A page whose only job is to forward must not be able to 500 because a
    // database it does not need is unreachable.
    getOpsSession.mockRejectedValue(new Error('ops database unreachable'));
    const { redirectedTo } = await visit(OpsLoginPage, { next: '/ops/depot' });
    expect(redirectedTo).toBe('/login?next=%2Fops%2Fdepot');
    expect(getOpsSession).not.toHaveBeenCalled();
  });

  it('still serves the legacy form behind ?legacy=1', async () => {
    // The rollback lever. If this stops working, a Supabase outage during the
    // cutover has no reachable door at all.
    const { redirectedTo, element } = await visit(OpsLoginPage, { legacy: '1' });
    expect(redirectedTo).toBeNull();
    render(element as React.ReactElement);
    expect(screen.getByRole('heading', { name: /operations sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /use the main sign-in/i })).toHaveAttribute('href', '/login');
  });

  it('serves the legacy form even when the ops database is down', async () => {
    getOpsSession.mockRejectedValue(new Error('ops database unreachable'));
    const { redirectedTo, element } = await visit(OpsLoginPage, { legacy: '1' });
    expect(redirectedTo).toBeNull();
    render(element as React.ReactElement);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('sends an already-signed-in operator on from the legacy form, admin included', async () => {
    getOpsSession.mockResolvedValue({ role: 'admin', email: 'a@example.com', sub: 'x' });
    const { redirectedTo } = await visit(OpsLoginPage, { legacy: '1' });
    expect(redirectedTo).toBe('/ops/admin/invites');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE NO-OPS-ACCESS STATE
// ───────────────────────────────────────────────────────────────────────────

describe('no ops access configured', () => {
  it('explains itself instead of bouncing or granting', async () => {
    getSupabaseUser.mockResolvedValue({ email: 'viewer@example.com' });
    currentOpsRole.mockResolvedValue(null);

    const { redirectedTo, element } = await visit(LoginPage, { next: '/ops/depot' });
    expect(redirectedTo).toBeNull();
    render(element as React.ReactElement);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(/no operations access configured/i);
    expect(notice).toHaveTextContent('/ops/depot');
    expect(notice).toHaveTextContent(/ask an administrator/i);
  });

  it('offers a way onward that is not the ops path it just refused', async () => {
    getSupabaseUser.mockResolvedValue({ email: 'viewer@example.com' });
    currentOpsRole.mockResolvedValue(null);

    const { element } = await visit(LoginPage, { next: '/ops/depot' });
    render(element as React.ReactElement);

    // Every link and button on the page must lead somewhere that works —
    // a "continue" pointing back at /ops/depot is a loop built by hand.
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/^\/ops\//);
    }
    expect(screen.getByRole('link', { name: /continue to project/i })).toHaveAttribute(
      'href',
      DEFAULT_NEXT,
    );
  });

  it('shows the same explanation when the sign-in call sent them back', async () => {
    // POST /api/auth/login decides this at sign-in time and returns
    // /login?notice=... — it has no `next` to hand on.
    getSupabaseUser.mockResolvedValue({ email: 'viewer@example.com' });
    currentOpsRole.mockResolvedValue(null);

    const { element } = await visit(LoginPage, { notice: NO_OPS_ACCESS_NOTICE });
    render(element as React.ReactElement);
    expect(screen.getByRole('status')).toHaveTextContent(/no operations access configured/i);
  });

  it('does not accuse an account that does have a role', async () => {
    // A stale or hand-typed ?notice must not tell a working operator they
    // have no access.
    getSupabaseUser.mockResolvedValue({ email: 'depot@example.com' });
    currentOpsRole.mockResolvedValue('depot' satisfies OpsRole);

    const { element } = await visit(LoginPage, { notice: NO_OPS_ACCESS_NOTICE });
    render(element as React.ReactElement);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never says WHY — /login is public and must not enumerate accounts', async () => {
    getSupabaseUser.mockResolvedValue({ email: 'viewer@example.com' });
    currentOpsRole.mockResolvedValue(null);

    const { element } = await visit(LoginPage, { next: '/ops/depot' });
    render(element as React.ReactElement);
    const notice = screen.getByRole('status');
    for (const leak of [/disabled/i, /suspended/i, /not linked/i, /unlinked/i, /expired/i]) {
      expect(notice.textContent ?? '', String(leak)).not.toMatch(leak);
    }
  });

  it('leaves an ordinary project viewer alone', async () => {
    // No ops profile is the NORMAL state for a project viewer. Someone who
    // never asked for an ops screen must not be shown an access warning.
    getSupabaseUser.mockResolvedValue({ email: 'viewer@example.com' });
    currentOpsRole.mockResolvedValue(null);

    const { element } = await visit(LoginPage, {});
    render(element as React.ReactElement);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('link', { name: /continue to upsrtc project/i })).toHaveAttribute(
      'href',
      DEFAULT_NEXT,
    );
  });

  it('offers an operator their own dashboard, correctly labelled', async () => {
    getSupabaseUser.mockResolvedValue({ email: 'admin@example.com' });
    currentOpsRole.mockResolvedValue('admin' satisfies OpsRole);

    const { element } = await visit(LoginPage, {});
    render(element as React.ReactElement);
    const link = screen.getByRole('link', { name: /continue to operations/i });
    expect(link).toHaveAttribute('href', '/ops/admin/invites');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE CUTOVER STATE: A REAL OPERATOR THE EDGE GATE CANNOT SEE YET
// ───────────────────────────────────────────────────────────────────────────

describe('operations access not applied to the sign-in yet', () => {
  /** Linked, active, correctly roled — and holding a token with no claim. */
  function claimlessOperator(role: OpsRole): void {
    getSupabaseUser.mockResolvedValue({ email: `${role}@example.com` });
    currentOpsRole.mockResolvedValue(role);
    opsClaimReady.mockReturnValue(false);
  }

  it('never offers a link into the console it cannot open', async () => {
    // This is the defect, exactly: the page rendered a "Continue to
    // Operations" button that bounced off the edge gate and landed back here.
    // A loop with no automatic hop is still a loop; the user just drives it.
    claimlessOperator('control_room');

    const { redirectedTo, element } = await visit(LoginPage, { next: '/ops/control-room' });
    expect(redirectedTo).toBeNull();
    render(element as React.ReactElement);

    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      // /ops/login is the deliberate exception: it is a public ops page that
      // renders the fallback form, not a gated screen that bounces.
      if (href.startsWith('/ops/login')) continue;
      expect(href, `link to ${href} bounces straight back here`).not.toMatch(/^\/ops\//);
    }
    expect(screen.queryByRole('link', { name: /continue to operations/i })).toBeNull();
  });

  it('says what is actually wrong, not that the account has no access', async () => {
    claimlessOperator('control_room');

    const { element } = await visit(LoginPage, { next: '/ops/control-room' });
    render(element as React.ReactElement);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(/not been applied to your sign-in yet/i);
    expect(notice).toHaveTextContent(/control room/i);
    // The opposite claim would send an on-shift operator chasing a role they
    // already hold, while the real fault goes unreported.
    expect(notice.textContent ?? '').not.toMatch(/no operations access configured/i);
  });

  it('shows the same explanation when the sign-in call sent them back', async () => {
    claimlessOperator('depot');

    const { element } = await visit(LoginPage, { notice: OPS_ACCESS_PENDING_NOTICE });
    render(element as React.ReactElement);
    expect(screen.getByRole('status')).toHaveTextContent(/not been applied to your sign-in yet/i);
  });

  it('does not tell a fully working operator their access is pending', async () => {
    // A stale or hand-typed ?notice must not manufacture the state.
    getSupabaseUser.mockResolvedValue({ email: 'depot@example.com' });
    currentOpsRole.mockResolvedValue('depot' satisfies OpsRole);
    opsClaimReady.mockReturnValue(true);

    const { element } = await visit(LoginPage, { notice: OPS_ACCESS_PENDING_NOTICE });
    render(element as React.ReactElement);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('link', { name: /continue to operations/i })).toBeInTheDocument();
  });

  it('points at the fallback sign-in, which is the door that still works', async () => {
    // /ops/login?legacy=1 is not gated on the missing claim, so it is a real
    // way in rather than another bounce.
    claimlessOperator('dispatcher');

    const { element } = await visit(LoginPage, {});
    render(element as React.ReactElement);
    expect(screen.getByRole('link', { name: /operations fallback sign-in/i })).toHaveAttribute(
      'href',
      OPS_LEGACY_LOGIN_PATH,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE FORM FOLLOWS THE SERVER
// ───────────────────────────────────────────────────────────────────────────

describe('sign-in form navigation', () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign, href: 'https://olympuss.test/login' },
    });
  });

  /** Declared with fetch's real signature so `mock.calls` keeps its types. */
  type FetchCall = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  function mockLogin(status: number, body: unknown) {
    const fetchMock = vi.fn<FetchCall>(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function submit() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
  }

  it('goes where the server says, not where the form guessed', async () => {
    // Only the server knows the role, so only the server can name the right
    // dashboard. If the form applied its own `next` instead, all seven roles
    // would land on the same screen.
    mockLogin(200, { ok: true, redirectTo: '/ops/control-room' });
    render(<LoginForm next="/project/upsrtc" />);
    await submit();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/ops/control-room'));
  });

  it('sends the requested next up for the server to sanitize', async () => {
    const fetchMock = mockLogin(200, { ok: true, redirectTo: '/ops/depot' });
    render(<LoginForm next="/ops/depot" />);
    await submit();
    await waitFor(() => expect(assign).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.next).toBe('/ops/depot');
  });

  it('follows the server back to the no-access explanation', async () => {
    mockLogin(200, { ok: true, redirectTo: `/login?notice=${NO_OPS_ACCESS_NOTICE}` });
    render(<LoginForm next="/ops/depot" />);
    await submit();
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/login?notice=${NO_OPS_ACCESS_NOTICE}`),
    );
  });

  it('still works against a server that sends no destination', async () => {
    // Old bundle / new server, or the reverse, during a rolling deploy.
    mockLogin(200, { ok: true });
    render(<LoginForm next="/project/bunching" />);
    await submit();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/project/bunching'));
  });

  it('points a 503 at the legacy door, which is the one that still works', async () => {
    // 503 means Supabase is the thing that is unavailable. Pointing at
    // /ops/login would forward straight back here; the escape hatch does not.
    mockLogin(503, { error: 'Authentication is not configured.' });
    render(<LoginForm next="/project/upsrtc" />);
    await submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/your credentials are not the problem/i);
    expect(screen.getByRole('link', { name: /operations sign-in/i })).toHaveAttribute(
      'href',
      OPS_LEGACY_LOGIN_PATH,
    );
    expect(assign).not.toHaveBeenCalled();
  });
});
