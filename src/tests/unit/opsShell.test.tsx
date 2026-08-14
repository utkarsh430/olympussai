// @vitest-environment jsdom
//
// The operations console's application shell.
//
// What it replaced was a max-width-3xl page with a title, an email address
// and a Sign out button — no navigation of any kind, so all twelve ops
// screens were reachable only by typing their URL. The assertions here are
// about the three properties that made that shape unusable, plus the one
// property the old shell had that must survive intact:
//
//   1. NAVIGATION EXISTS, AND IT IS THE OPERATOR'S OWN. Each persona sees
//      its own destinations and nothing else, and the entry they are
//      currently reading is marked — including on a detail screen that has
//      no entry of its own.
//   2. EVERY GUARDED PAGE IS REACHABLE. A thirteenth dashboard added with no
//      way to click to it fails here, which is exactly how the first twelve
//      ended up URL-only.
//   3. THE NAV NEVER OFFERS A PAGE THE ROLE CANNOT OPEN. The nav table is
//      presentation, the per-page `requireOpsRolePage` call is the
//      authority, and a link to a page that answers /ops/forbidden is a lie
//      told to an operator on shift. Cross-checked against what each page
//      actually guards on, in the App Router directory.
//   4. ONE <h1>, CARRYING THE PAGE TITLE. tests/e2e/ops-dashboard-pages.spec
//      .ts proves each dashboard rendered (rather than redirecting to
//      sign-in, which is also a 200) by finding that heading, so it is load-
//      bearing beyond tidiness.
//
// Sign-out has its own suite next door — opsShellSignOutButton.test.tsx —
// and that behaviour moved into OpsSignOut.tsx unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { OpsShell } from '@/components/ops/OpsShell';
import { OPS_NAV, activeNavHref } from '@/components/ops/navigation';
import { OPS_ROLES, type OpsRole } from '@/lib/auth/rbac/roles';

const pathname = vi.hoisted(() => ({ current: null as string | null }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}));

beforeEach(() => {
  pathname.current = null;
});

describe('OpsShell chrome', () => {
  it('renders the page title as the page’s only h1', () => {
    render(<OpsShell title="Control Room" email="cr@olympuss.local" role="control_room" />);

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Control Room');
  });

  it('shows the signed-in identity and a sign-out control', () => {
    render(<OpsShell title="Depot" email="depot@olympuss.local" role="depot" />);

    expect(screen.getByText('depot@olympuss.local')).toBeInTheDocument();
    expect(screen.getByTestId('ops-sign-out')).toBeInTheDocument();
  });

  it('renders the subtitle, actions, status strip and body slots', () => {
    render(
      <OpsShell
        title="Incident Timeline"
        email="cr@olympuss.local"
        role="control_room"
        subtitle="incident-42"
        actions={<button type="button">Refresh</button>}
        statusStrip={<span>7 active incidents</span>}
      >
        <p>dashboard body</p>
      </OpsShell>,
    );

    expect(screen.getByText('incident-42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByText('7 active incidents')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('dashboard body')).toBeInTheDocument();
  });

  it('gives the map variant a main pane that can actually have a height', () => {
    // Google Maps sizes to its container, and a container inside an
    // auto-height ancestor resolves to zero — which is the whole reason the
    // full variant exists. At `lg` <main> must be a flex child of a
    // screen-height shell, with a floor under it so flex cannot shrink it
    // below the height the map frame insists on.
    const { container } = render(
      <OpsShell
        title="Control Room"
        email="cr@olympuss.local"
        role="control_room"
        variant="full"
      />,
    );

    const shell = container.querySelector('[data-ops-shell]');
    expect(shell).toHaveAttribute('data-variant', 'full');
    expect(String(shell?.className).split(/\s+/)).toContain('lg:h-[100dvh]');

    const main = screen.getByRole('main');
    expect(main.className).toContain('lg:flex-1');
    expect(main.className).toContain('lg:min-h-[30rem]');
  });

  it.each(['document', 'wide', 'full'] as const)(
    'never clips its own content away — %s',
    (variant) => {
      // The defect this locks out: `full` was `h-[100dvh] overflow-hidden`, so
      // any console taller than the viewport had its overflow DISCARDED rather
      // than scrolled to. On a 1280x800 laptop the chrome above <main> took
      // 63% of the screen and the map's own zoom controls sat below the fold
      // of an unscrollable box; at phone size the whole console did. Neither
      // showed a scrollbar, because clipped content does not overflow.
      //
      // A shell may size itself to the screen. It may never make the part that
      // does not fit unreachable — so a screen-height shell must pair that
      // height with a scrollbar, and `overflow-hidden` is forbidden outright.
      const { container } = render(
        <OpsShell
          title="Control Room"
          email="cr@olympuss.local"
          role="control_room"
          variant={variant}
        />,
      );

      // Tokenised, not substring-matched: `min-h-[100dvh]` CONTAINS the string
      // `h-[100dvh]`, so a substring assertion here would pass on the very
      // class it is meant to forbid.
      const classes = String(container.querySelector('[data-ops-shell]')?.className ?? '').split(
        /\s+/,
      );

      expect(classes).toContain('min-h-[100dvh]');
      expect(classes.filter((c) => c.includes('overflow-hidden'))).toEqual([]);

      // Any class that pins a height — at any breakpoint — must be accompanied
      // by a scroll escape at that same breakpoint.
      for (const pinned of classes.filter((c) => /(^|:)h-\[100dvh\]$/.test(c))) {
        const breakpoint = pinned.includes(':') ? `${pinned.split(':')[0]}:` : '';
        expect(classes, `${pinned} pins a height with no way to scroll past it`).toContain(
          `${breakpoint}overflow-y-auto`,
        );
      }
    },
  );

  it('offers a skip link straight to the dashboard', () => {
    render(<OpsShell title="Planner" email="p@olympuss.local" role="planner" />);

    expect(screen.getByRole('link', { name: /skip to dashboard/i })).toHaveAttribute(
      'href',
      '#ops-main',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'ops-main');
  });

  it('still renders without a role, showing no navigation', () => {
    // A missing role must degrade to "no nav", never to a blank console: the
    // shell is the last thing that should fall over.
    render(<OpsShell title="Driver" email="driver@olympuss.local" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Driver' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('OpsShell navigation', () => {
  it('shows each persona exactly its own destinations', () => {
    for (const role of OPS_ROLES) {
      pathname.current = OPS_NAV[role][0]!.href;
      const { unmount } = render(
        <OpsShell title="Screen" email="who@olympuss.local" role={role} />,
      );

      const nav = screen.getByRole('navigation', { name: /operations console/i });
      const hrefs = within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'));

      expect(hrefs, `nav for ${role}`).toEqual(OPS_NAV[role].map((item) => item.href));
      unmount();
    }
  });

  it('marks the entry the operator is currently reading', () => {
    pathname.current = '/ops/control-room/observability';
    render(<OpsShell title="Live Observability" email="cr@olympuss.local" role="control_room" />);

    const current = screen.getByRole('link', { current: 'page' });
    expect(current).toHaveAttribute('href', '/ops/control-room/observability');
  });

  it('keeps a detail screen anchored to the section it belongs to', () => {
    // /ops/control-room/incidents/<id> has no nav entry of its own. Without
    // the `matches` prefix the operator would lose their place entirely.
    pathname.current = '/ops/control-room/incidents/abc-123';
    render(<OpsShell title="Incident Timeline" email="cr@olympuss.local" role="control_room" />);

    expect(screen.getByRole('link', { current: 'page' })).toHaveAttribute(
      'href',
      '/ops/control-room',
    );
  });

  it('marks nothing when the pathname is unknown', () => {
    pathname.current = null;
    render(<OpsShell title="Control Room" email="cr@olympuss.local" role="control_room" />);
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });
});

describe('activeNavHref', () => {
  const items = OPS_NAV.control_room;

  it('prefers the longest match rather than the first', () => {
    // /ops/control-room is a prefix of every other control-room route, so a
    // naive scan highlights "Control room" while the operator reads Copilot.
    expect(activeNavHref(items, '/ops/control-room/copilot')).toBe('/ops/control-room/copilot');
    expect(activeNavHref(items, '/ops/control-room')).toBe('/ops/control-room');
  });

  it('does not match a sibling that merely shares a prefix string', () => {
    expect(activeNavHref(items, '/ops/control-room-archive')).toBeNull();
  });

  it('returns null for a path outside this persona', () => {
    expect(activeNavHref(items, '/ops/depot')).toBeNull();
    expect(activeNavHref(items, null)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE NAV TABLE AGAINST THE ROUTER
// ───────────────────────────────────────────────────────────────────────────

const OPS_APP_DIR = join(process.cwd(), 'src/app/(ops)/ops');
/** Unguarded by design: you cannot have a session before you have signed in. */
const PUBLIC_PAGES = ['login', 'forbidden', 'accept-invite', 'unavailable'];

interface GuardedPage {
  /** Route path, e.g. /ops/control-room/observability. */
  readonly route: string;
  /** The role its own `requireOpsRolePage(...)` call demands. */
  readonly role: OpsRole;
}

function guardedPages(): GuardedPage[] {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name === 'page.tsx' ? [full] : [];
    });
  }

  return walk(OPS_APP_DIR)
    .filter((file) => !PUBLIC_PAGES.some((name) => file.includes(`${sep}${name}${sep}`)))
    .map((file) => {
      const source = readFileSync(file, 'utf8');
      const guard = /requireOpsRolePage\(\s*'([a-z_]+)'/.exec(source);
      if (!guard) throw new Error(`${file} is under a guarded segment but calls no page guard`);
      const route = `/ops${file
        .slice(OPS_APP_DIR.length, -`${sep}page.tsx`.length)
        .split(sep)
        .join('/')}`;
      return { route, role: guard[1] as OpsRole };
    });
}

describe('the navigation table against the App Router', () => {
  it('never links a role to a page that role cannot open', () => {
    const guardOf = new Map(guardedPages().map((page) => [page.route, page.role]));

    for (const role of OPS_ROLES) {
      for (const item of OPS_NAV[role]) {
        const guard = guardOf.get(item.href);
        expect(
          guard,
          `${item.href} is in ${role}'s nav but is not a guarded ops page`,
        ).toBeDefined();
        expect(guard, `${item.href} is offered to ${role} but is guarded for ${guard}`).toBe(role);
      }
    }
  });

  it('leaves no guarded page reachable only by typing its URL', () => {
    // Dynamic segments have no literal href; they are expected to be covered
    // by a parent entry's `matches` prefix instead.
    for (const { route, role } of guardedPages()) {
      const probe = route.replace(/\[[^\]]+\]/g, 'sample-id');
      expect(
        activeNavHref(OPS_NAV[role], probe),
        `${route} has no navigation entry and no parent claiming it — a ${role} could only reach it by typing the URL`,
      ).not.toBeNull();
    }
  });
});
