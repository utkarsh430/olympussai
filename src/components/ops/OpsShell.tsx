'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { OpsRole } from '@/lib/auth/rbac/roles';
import { OPS_NAV, OPS_ROLE_LABEL, activeNavHref } from './navigation';
import { OpsSignOut } from './OpsSignOut';

/**
 * The application shell for the whole operations console.
 *
 * ─── WHAT THIS REPLACED, AND WHY ─────────────────────────────────────────
 *
 * A `max-w-3xl` page with a title, an email address and a Sign out button.
 * That shape was honest about its own scope when it was written — its
 * ticket was the auth/guard/audit layer, and it said so — but it has three
 * properties the real operational system cannot live with:
 *
 *   • 48rem of column. The live fleet is ~9,170 vehicles and the map that
 *     shows them is the point of the product. Nothing map-scale fits.
 *   • No navigation. Twelve screens, reachable only by typing the URL.
 *   • No standing place for status. Feed provenance, active kill switches
 *     and headway KPIs scrolled away with the page body, so the operator
 *     could be looking at an outage banner that was two screens up.
 *
 * The look is LIFTED from /project/upsrtc rather than designed here: same
 * void ground, same Orbitron display face, same mono/uppercase instrument
 * labelling, same cyan accent, same tabular figures. See
 * src/components/ops/ui/primitives.tsx and the `.ops-*` block in
 * src/app/globals.css for where those decisions are actually made.
 *
 * ─── THE FOUR SLOTS ──────────────────────────────────────────────────────
 *
 *   title        the page's only <h1>. Also the handle the end-to-end suite
 *                uses to prove a dashboard rendered rather than redirecting
 *                to sign-in (tests/e2e/ops-dashboard-pages.spec.ts), so it
 *                must stay an <h1> with the exact page title.
 *   actions      page-level controls, top right, beside the identity block.
 *   statusStrip  pinned band under the chrome, above the scroll region.
 *                Feed provenance, kill switches, KPIs — anything that must
 *                not scroll away. Use OpsStatStrip from ui/primitives.
 *   children     the dashboard, inside <main id="ops-main">.
 *
 * ─── THE THREE VARIANTS ──────────────────────────────────────────────────
 *
 *   document  (default) centred, readable measure. Forms, admin screens,
 *             the incident timeline.
 *   wide      full-width with a sane cap. Table- and panel-heavy dashboards.
 *   full      the page does not scroll and <main> is a real flex child with
 *             `min-h-0`. This is the one a map needs: Google Maps sizes to
 *             its container, and a container inside an auto-height ancestor
 *             resolves to zero. Pair with OpsMapFrame.
 *
 * ─── COMPATIBILITY ───────────────────────────────────────────────────────
 *
 * `role` is optional. It should always be passed — it is what selects the
 * navigation — but a shell that threw without it would turn a missing prop
 * into a blank console, and the sign-out unit test renders the shell with
 * nothing but a title and an email on purpose. Without a role the shell
 * renders correctly and simply shows no navigation.
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
  // directly), which is fine: no pathname simply means no entry is marked
  // current.
  const pathname = usePathname();
  const navItems = role ? OPS_NAV[role] : [];
  const currentHref = activeNavHref(navItems, pathname);

  return (
    <div
      data-ops-shell
      data-variant={variant}
      className={cn(
        'relative flex flex-col bg-ops-bg font-display text-ops-ink antialiased',
        // Tabular figures across the entire console, for the same reason the
        // command centre sets them: a readout whose digits change width
        // jitters on every poll.
        "[font-feature-settings:'tnum'_1]",
        variant === 'full' ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]',
      )}
    >
      <OpsBackdrop />

      <a
        href="#ops-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-holo-glow focus:px-4 focus:py-2 focus:font-mono focus:text-xs focus:text-void"
      >
        Skip to dashboard
      </a>

      <header className="relative z-30 shrink-0 border-b border-ops-line bg-[rgb(4,9,18)]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-3">
          <OpsBrand role={role} />

          <div className="h-8 w-px shrink-0 bg-ops-line" aria-hidden />

          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-ops-ink">{title}</h1>
            {subtitle ? (
              <p className="truncate font-mono text-[11px] text-ops-faint">{subtitle}</p>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-4">
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            <div className="hidden text-right leading-tight sm:block">
              <div className="ops-eyebrow">Signed in</div>
              <div
                className="max-w-[18rem] truncate font-mono text-xs text-ops-muted"
                title={email}
              >
                {email}
              </div>
            </div>
            <OpsSignOut />
          </div>
        </div>

        {navItems.length > 0 && (
          <nav aria-label="Operations console" className="border-t border-ops-line/70 px-6">
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
        <div className="relative z-20 shrink-0 border-b border-ops-line bg-ops-surface/80">
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
      {/* The same restrained gold ascending-peak mark the command centre's
          top bar carries (ProjectSignOut), so an operator moving between the
          two surfaces is visibly inside one product. Inline SVG rather than
          a raster asset, for the same reason it is inline there. */}
      <span aria-hidden className="relative flex h-8 w-8 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-[#d6a13a]/45" />
        <svg viewBox="0 0 24 24" className="relative h-3.5 w-3.5" fill="none">
          <path
            d="M4 18 L12 6 L20 18"
            stroke="#f3c86a"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="leading-tight">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[#e8c477]">
          Olympuss AI
        </div>
        <div className="whitespace-nowrap font-mono text-[8px] uppercase tracking-[0.16em] text-[#d6a13a]/70">
          {role ? `${OPS_ROLE_LABEL[role]} console` : 'Operations console'}
        </div>
      </div>
    </div>
  );
}

/**
 * Ambient ground for the console.
 *
 * The command centre's `AmbientBackdrop` drifts particles, runs a scanline
 * and pulls in framer-motion. This surface is read for a whole shift and
 * includes forms, so it keeps the grid and the volumetric wash, animates
 * nothing, and ships no motion library. Pure CSS, one element, and
 * `prefers-reduced-motion` has nothing to reduce.
 */
function OpsBackdrop() {
  return <div aria-hidden className="ops-backdrop pointer-events-none fixed inset-0 z-0" />;
}
