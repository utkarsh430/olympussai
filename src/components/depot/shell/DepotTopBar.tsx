import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { DepotSignOut } from './DepotSignOut';

/** Sticky 56px bar: product title and scope on the left, exits on the right. */
export function DepotTopBar() {
  return (
    <header
      data-testid="depot-top-bar"
      className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-depot-line bg-depot-page px-6"
    >
      <div className="flex min-w-0 items-baseline gap-4">
        <span className="whitespace-nowrap font-display text-sm uppercase tracking-[0.14em] text-depot-ink">
          Depot Management
        </span>
        <span className="depot-label hidden whitespace-nowrap sm:inline">UPSRTC / Network</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
