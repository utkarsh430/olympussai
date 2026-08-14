'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { OpsRole } from '@/lib/auth/rbac/roles';
import { OPS_NAV, OPS_ROLE_LABEL, activeNavHref } from './navigation';
import { OpsSignOut } from './OpsSignOut';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

/**
 * The application shell for the whole operations console.
 *
 * ─── THE FIVE SLOTS ──────────────────────────────────────────────────────
 *
 *   title        the page's only <h1>. Also the handle the end-to-end suite
 *                uses to prove a dashboard rendered rather than redirecting
 *                to sign-in (tests/e2e/ops-dashboard-pages.spec.ts), so it
 *                must stay an <h1> carrying the exact page title.
 *   subtitle     one quiet line under the title.
 *   actions      page-level controls, top right, beside the identity block.
 *   statusStrip  pinned band under the chrome, above the scroll region.
 *                Feed provenance, stopped instructions, key figures —
 *                anything that must not scroll away. Use OpsStatStrip.
 *   children     the dashboard, inside <main id="ops-main">.
 *
 * ─── THE THREE VARIANTS ──────────────────────────────────────────────────
 *
 *   document  (default) centred, readable measure. Forms, admin screens, the
 *             incident timeline.
 *   wide      full-width with a sane cap. Table- and panel-heavy dashboards.
 *   full      at `lg` and up, <main> is a real flex child of a screen-height
 *             shell, so it resolves to a definite number; below `lg` it is an
 *             ordinary block that grows. This is the one a map needs: Google
 *             Maps sizes to its container, and a container inside an
 *             auto-height ancestor resolves to zero. Pair with OpsMapFrame,
 *             and see FULL_MAIN for the floor that keeps that true on a short
 *             screen.
 *
 * ─── NO VARIANT MAY CLIP ITSELF ──────────────────────────────────────────
 *
 * `full` used to be `h-[100dvh] overflow-hidden` — the page pinned to exactly
 * one viewport, with the overflow thrown away rather than scrolled to. That
 * held only while the chrome above <main> stayed small, and the chrome is not
 * small: `header` and the `statusStrip` slot are both `shrink-0` and both GROW
 * as the viewport narrows, because their contents wrap. Measured on the
 * control room:
 *
 *     1512 x 945   header 103 + band 289 =  392px   41% of the screen
 *     1280 x 800   header 145 + band 362 =  507px   63% of the screen
 *      390 x 844   header 255 + band 704 =  959px  114% of the screen
 *
 * At 1280x800 that left 293px for a console whose map frame alone asks for
 * 384px, so 138px of the working rail — including the map's own zoom
 * controls — sat below the fold of a container with `overflow: hidden`. At
 * phone size <main> collapsed to its own padding and the ENTIRE console was
 * discarded. In neither case was there a scrollbar, because there was nothing
 * to scroll: the content was clipped, not overflowing.
 *
 * `overflow-hidden` is therefore gone from every variant, and it is replaced by
 * two different escapes, because the two screen shapes want different things.
 *
 * AT `lg` AND UP — the wall display and the desk — the shell keeps a DEFINITE
 * `h-[100dvh]` and scrolls itself with `overflow-y-auto`. The definite height
 * is what buys the console its shape: <main> resolves to a real number, the
 * map fills its half of the row, and the working rail scrolls INSIDE itself
 * rather than growing the page. That is the whole premise of a console built
 * around a map that must never scroll away, and it survives here untouched.
 * All that changed is where the part that does not fit goes: down a scrollbar
 * instead of into the bin. On a 1280x800 laptop that is 187px of scrolling to
 * reach a map and a rail that were previously unreachable at any scroll
 * position.
 *
 * BELOW `lg` — a phone, a depot tablet — the shell takes a MINIMUM height and
 * <main> is an ordinary auto-height block. The row has already stacked to one
 * column by then, so there is no map-beside-rail shape left to protect, and
 * one plain document scroll down the band, past the map, into the rail beats a
 * scrollbox nested inside a page that cannot scroll. A phone gets a phone page.
 *
 * FULL_MAIN's floor is what keeps the map honest at `lg` on the way down. Flex
 * would otherwise shrink <main> towards nothing, hand the map a container
 * shorter than the `minHeight` it insists on, and re-create the clip one level
 * further in — inside the row instead of around it.
 *
 * ─── NOTHING HERE SCALES ─────────────────────────────────────────────────
 *
 * No ancestor of the map may apply `transform: scale`. The fleet canvas
 * overlay projects vehicle positions in LAYOUT PIXELS, so a transform above
 * it slides every one of 9,200 buses off the road. This shell uses flex and
 * max-widths only. If a future responsive pass needs to shrink a dense
 * screen, change the layout or use `zoom` — never a transform.
 *
 * ─── COMPATIBILITY ───────────────────────────────────────────────────────
 *
 * `role` is optional. It should always be passed — it is what selects the
 * navigation — but a shell that threw without it would turn a missing prop
 * into a blank console, and the sign-out unit test renders the shell with
 * nothing but a title and an email on purpose. Without a role the shell
 * renders correctly and simply shows no navigation.
 *
 * ─── THIS IS NOT AN AUTHORIZATION BOUNDARY ───────────────────────────────
 *
 * The navigation decides what a role is SHOWN and nothing else. Every
 * destination is independently enforced by `requireOpsRolePage` in its own
 * route segment, which re-reads `ops_users` per render. This shell grants
 * nothing.
 */
export type OpsShellVariant = 'document' | 'wide' | 'full';

/**
 * The `full` variant's <main>, and the only place the two screen shapes differ.
 *
 * Below `lg` this is a plain auto-height block: the row underneath has already
 * stacked, so <main> simply grows and the document scrolls.
 *
 * At `lg` it becomes the pinned flex pane the map needs, with a 30rem floor.
 * 30rem leaves 456px inside `p-3`, which clears the 24rem (384px) minimum
 * every console here gives its map frame and still leaves room for the rail's
 * tab strip. Without the floor, flex shrinks <main> towards nothing on a short
 * screen and the map clips inside the row — the same defect one level down.
 * When there is more room than the floor, `flex-1` is in charge and the floor
 * never applies.
 *
 * A console needing a different floor passes its own through
 * `contentClassName`; Tailwind's later-wins ordering lets it override.
 */
const FULL_MAIN = 'flex flex-col p-3 lg:min-h-[30rem] lg:flex-1';

export function OpsShell({
  title,
  email,
  role,
  subtitle,
  actions,
  statusStrip,
  variant = 'document',
  contentClassName,
  children,
}: {
  title: string;
  email: string;
  role?: OpsRole;
  subtitle?: ReactNode;
  actions?: ReactNode;
  statusStrip?: ReactNode;
  variant?: OpsShellVariant;
  contentClassName?: string;
  children?: ReactNode;
}) {
  // Null outside an App Router context (a unit test rendering the shell
  // directly), which is fine: no pathname simply means no entry is current.
  const pathname = usePathname();
  const navItems = role ? OPS_NAV[role] : [];
  const currentHref = activeNavHref(navItems, pathname);

  return (
    <div
      data-ops-shell
      data-variant={variant}
      className={cn(
        'relative flex min-h-[100dvh] flex-col bg-background text-foreground antialiased',
        // The definite height that lets the map-and-rail shape exist, paired
        // with the scrollbar that keeps the part which does not fit reachable.
        // Never `overflow-hidden`: see "no variant may clip itself" above.
        variant === 'full' && 'lg:h-[100dvh] lg:overflow-y-auto',
      )}
    >
      <OpsBackdrop />

      <a
        href="#ops-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-primary-foreground"
      >
        Skip to dashboard
      </a>

      <header className="relative z-30 shrink-0 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-3">
          <OpsBrand role={role} />

          <div className="h-8 w-px shrink-0 bg-border" aria-hidden />

          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle ? <p className="truncate text-[11px] text-subtle">{subtitle}</p> : null}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            <ThemeToggle />
            <div className="hidden text-right leading-tight sm:block">
              <div className="ops-eyebrow">Signed in</div>
              <div className="max-w-[18rem] truncate text-xs text-muted-foreground" title={email}>
                {email}
              </div>
            </div>
            <OpsSignOut />
          </div>
        </div>

        {navItems.length > 0 && (
          <nav aria-label="Operations console" className="border-t border-border/70 px-6">
            <ul className="flex flex-wrap items-center gap-x-6">
              {navItems.map((item) => {
                const isCurrent = item.href === currentHref;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={cn('ops-nav-link', isCurrent && 'ops-nav-link-active')}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </header>

      {statusStrip ? (
        <div className="relative z-20 shrink-0 border-b border-border bg-card/80">
          {statusStrip}
        </div>
      ) : null}

      <main
        id="ops-main"
        className={cn(
          'relative z-10',
          variant === 'full'
            ? FULL_MAIN
            : variant === 'wide'
              ? 'mx-auto w-full max-w-[1680px] flex-1 px-6 py-8'
              : 'mx-auto w-full max-w-5xl flex-1 px-6 py-8',
          contentClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}

function OpsBrand({ role }: { role?: OpsRole }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {/* The restrained ascending-peak mark, inline rather than a raster asset
          so it inherits the theme and needs no second file per palette. */}
      <span aria-hidden className="relative flex h-8 w-8 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-primary/40" />
        <svg viewBox="0 0 24 24" className="relative h-3.5 w-3.5" fill="none">
          <path
            d="M4 18 L12 6 L20 18"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="leading-tight">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground">
          Olympuss AI
        </div>
        <div className="whitespace-nowrap text-[9px] uppercase tracking-[0.14em] text-subtle">
          {role ? `${OPS_ROLE_LABEL[role]} console` : 'Operations console'}
        </div>
      </div>
    </div>
  );
}

/**
 * Ambient ground for the console. Keeps the wash and the grid, animates
 * nothing: this surface is read for a whole shift, and `prefers-reduced-
 * motion` has nothing to reduce because there is no motion. Token-driven, so
 * it is a quiet tint in light mode rather than cyan on white.
 */
function OpsBackdrop() {
  return <div aria-hidden className="ops-backdrop pointer-events-none fixed inset-0 z-0" />;
}
