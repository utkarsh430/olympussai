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
 *   full      the page does not scroll and <main> is a real flex child with
 *             `min-h-0`. This is the one a map needs: Google Maps sizes to
 *             its container, and a container inside an auto-height ancestor
 *             resolves to zero. Pair with OpsMapFrame.
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
        'relative flex flex-col bg-background text-foreground antialiased',
        variant === 'full' ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]',
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
            ? 'flex min-h-0 flex-1 flex-col p-3'
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
