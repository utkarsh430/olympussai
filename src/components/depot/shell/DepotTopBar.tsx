import Link from 'next/link';
import { ArrowLeft, Warehouse } from 'lucide-react';
import { DepotBarMenu } from './DepotBarMenu';
import { DepotSignOut } from './DepotSignOut';
import { FeedStatus } from './FeedStatus';
import { ScopeSwitcher } from './ScopeSwitcher';

/**
 * The top bar. Its height and where it sticks come from the shell's custom
 * properties (`--depot-bar-h`), so the strip beneath it stacks on it exactly.
 * Two groups, in reading and tab order: A (product mark, scope switcher) and B
 * (feed chip, Operations, Sign out). It is one row at every width: A takes the free
 * width and truncates the switcher, B keeps its natural width at the right.
 *
 * - Below 640px the mark is a 20px glyph and the name is read to screen readers only:
 *   the 13px wordmark beside the chip and the Menu leaves no room for the scope at 360px.
 *   From 640px the wordmark is shown.
 * - Below 900px Operations and Sign out sit behind one Menu button, so nothing in the
 *   bar can push the page sideways at 360px. Below 640px the bar scrolls away; from
 *   640px it sticks at 3.25rem, the same row as on a phone.
 * - From 900px it sticks at 3.5rem, with Operations and Sign out in the row as quiet
 *   32px buttons (`depot-bar-button-quiet`), no heavier than the chip.
 */
export function DepotTopBar() {
  return (
    <header
      data-testid="depot-top-bar"
      className="relative z-40 flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-depot-line bg-depot-page px-4 sm:sticky sm:top-0 sm:h-[var(--depot-bar-h)] sm:gap-4 sm:px-6"
    >
      <div
        data-testid="depot-top-bar-scope"
        className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4"
      >
        <span
          data-testid="depot-brand"
          className="flex shrink-0 items-center whitespace-nowrap font-display text-sm uppercase tracking-[0.14em] text-depot-ink"
        >
          <Warehouse className="h-5 w-5 sm:hidden" aria-hidden />
          <span className="max-sm:sr-only">Depot Management</span>
        </span>
        <div className="min-w-0">
          <ScopeSwitcher />
        </div>
      </div>
      <div data-testid="depot-top-bar-actions" className="flex shrink-0 items-center gap-2">
        <FeedStatus />
        <Link
          href="/project/upsrtc"
          data-testid="depot-back-to-operations"
          className="depot-bar-button depot-bar-button-quiet hidden min-[900px]:inline-flex"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Operations
        </Link>
        <span className="hidden min-[900px]:contents">
          <DepotSignOut quiet />
        </span>
        <DepotBarMenu />
      </div>
    </header>
  );
}
