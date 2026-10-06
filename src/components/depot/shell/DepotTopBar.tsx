import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { DepotSignOut } from './DepotSignOut';
import { FeedStatus } from './FeedStatus';
import { ScopeSwitcher } from './ScopeSwitcher';

/**
 * The top bar. Its height and where it sticks come from the shell's custom
 * properties (`--depot-bar-h`), so the strips beneath it can stack on it exactly.
 * Two groups, in reading and tab order: A (product title, scope switcher) and B
 * (feed chip, Operations, Sign out).
 *
 * - Below 640px the bar is not sticky and has three rows: the title, the scope
 *   switcher on its own full-width row (it truncates its label), and the chip with
 *   the two buttons, which wrap if the screen is very narrow.
 * - From 640 to 899px it is sticky and two fixed rows of 2.5rem: title and switcher,
 *   then the chip at the left and the buttons at the right.
 * - From 900px it is sticky and one row of 3.5rem: A takes the free width and
 *   truncates the switcher, B keeps its natural width at the right.
 *
 * The switcher and the chip are never in the same row at a width where they could
 * overlap: below 900px they are in different rows, and from 900px the switcher is
 * `min-w-0` inside a group that shrinks while the chip group is `shrink-0`.
 */
export function DepotTopBar() {
  return (
    <header
      data-testid="depot-top-bar"
      className="z-40 flex shrink-0 flex-col gap-1.5 border-b border-depot-line bg-depot-page px-4 py-2 sm:sticky sm:top-0 sm:h-[var(--depot-bar-h)] sm:gap-0 sm:px-6 sm:py-0 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between min-[900px]:gap-4"
    >
      <div
        data-testid="depot-top-bar-scope"
        className="flex min-w-0 flex-col gap-1 sm:h-10 sm:flex-row sm:items-center sm:gap-4 min-[900px]:h-auto min-[900px]:flex-1"
      >
        <span className="whitespace-nowrap font-display text-sm uppercase tracking-[0.14em] text-depot-ink">
          Depot Management
        </span>
        <div className="min-w-0">
          <ScopeSwitcher />
        </div>
      </div>
      <div
        data-testid="depot-top-bar-actions"
        className="flex flex-wrap items-center gap-2 sm:h-10 sm:flex-nowrap min-[900px]:h-auto min-[900px]:shrink-0"
      >
        <FeedStatus />
        <Link
          href="/project/upsrtc"
          data-testid="depot-back-to-operations"
          className="depot-bar-button sm:ml-auto min-[900px]:ml-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Operations
        </Link>
        <DepotSignOut />
      </div>
    </header>
  );
}
