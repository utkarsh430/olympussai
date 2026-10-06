import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { DepotSignOut } from './DepotSignOut';
import { FeedStatus } from './FeedStatus';
import { ScopeSwitcher } from './ScopeSwitcher';

/** Sticky 56px bar: product title and scope on the left, exits on the right. */
export function DepotTopBar() {
  return (
    <header
      data-testid="depot-top-bar"
      className="sticky top-0 z-40 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-depot-line bg-depot-page px-6 py-2 sm:h-14 sm:flex-nowrap sm:py-0"
    >
      <div className="flex min-w-0 items-center gap-4">
        <span className="whitespace-nowrap font-display text-sm uppercase tracking-[0.14em] text-depot-ink">
          Depot Management
        </span>
        <div className="min-w-0">
          <ScopeSwitcher />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <FeedStatus />
        <Link
          href="/project/upsrtc"
          data-testid="depot-back-to-operations"
          className="hud-button whitespace-nowrap"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Operations
        </Link>
        <DepotSignOut />
      </div>
    </header>
  );
}
