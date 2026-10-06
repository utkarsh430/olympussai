import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { DepotBarMenu } from './DepotBarMenu';
import { DepotSignOut } from './DepotSignOut';
import { FeedStatus } from './FeedStatus';
import { ScopeSwitcher } from './ScopeSwitcher';

/**
 * The top bar. Its height and where it sticks come from the shell's custom
 * properties (`--depot-bar-h`), so the strip beneath it stacks on it exactly.
 * Two groups, in reading and tab order: A (product mark, scope switcher) and B
 * (feed chip, Operations, Sign out).
 *
 * - Below 640px it is one row that scrolls away: the mark as a glyph (the name is
 *   still read to screen readers), the scope switcher taking the free width and
 *   truncating, the feed chip (a word and a time), and one Menu button holding
 *   Operations and Sign out, so nothing in it can push the page sideways at 360px.
 * - From 640 to 899px it is sticky and two fixed rows of 2.5rem: title and switcher,
 *   then the chip at the left and the buttons at the right.
 * - From 900px it is sticky and one row of 3.5rem: A takes the free width and
 *   truncates the switcher, B keeps its natural width at the right.
 */
export function DepotTopBar() {
  return (
    <header
      data-testid="depot-top-bar"
      className="relative z-40 flex h-12 shrink-0 items-center gap-2 border-b border-depot-line bg-depot-page px-4 sm:sticky sm:top-0 sm:h-[var(--depot-bar-h)] sm:flex-col sm:items-stretch sm:gap-0 sm:px-6 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between min-[900px]:gap-4"
    >
      <div
        data-testid="depot-top-bar-scope"
        className="flex min-w-0 flex-1 items-center gap-2 sm:h-10 sm:flex-none sm:gap-4 min-[900px]:h-auto min-[900px]:flex-1"
      >
        <span className="shrink-0 whitespace-nowrap font-display text-sm uppercase tracking-[0.14em] text-depot-ink">
          <span aria-hidden className="sm:hidden">
            DM
          </span>
          <span className="max-sm:sr-only">Depot Management</span>
        </span>
        <div className="min-w-0">
          <ScopeSwitcher />
        </div>
      </div>
      <div
        data-testid="depot-top-bar-actions"
        className="flex shrink-0 items-center gap-2 sm:h-10 min-[900px]:h-auto"
      >
        <FeedStatus />
        <Link
          href="/project/upsrtc"
          data-testid="depot-back-to-operations"
          className="depot-bar-button max-sm:hidden sm:ml-auto min-[900px]:ml-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Operations
        </Link>
        <span className="contents max-sm:hidden">
          <DepotSignOut />
        </span>
        <DepotBarMenu />
      </div>
    </header>
  );
}
