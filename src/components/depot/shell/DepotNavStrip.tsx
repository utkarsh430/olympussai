'use client';

import type { ShellNav } from '@/lib/depot/shellModel';
import { NavLinks } from './NavLinks';
import { ScrollStrip } from './ScrollStrip';

const SCROLLER =
  'flex h-full items-center gap-4 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * The single navigation strip below 1280px (the rail's breakpoint). In depot scope it
 * shows the depot's pages and nothing else; in network scope, the network links. The way
 * from a depot to the network is the scope switcher in the bar ("Network" is its first
 * option), and the bar's Menu lists every network page, so the strip carries no fixed
 * item: its scrolling frame is its only child, and the frame's end caps and fades sit at
 * the strip's two outer ends (`ScrollStrip`), only while it overflows. The active link
 * is centred on load and on every route change. It sticks under the bar from 640px
 * (`--depot-bar-h`) at `--depot-nav-h`.
 */
export function DepotNavStrip({
  nav,
  pathname,
}: {
  readonly nav: ShellNav;
  readonly pathname: string;
}) {
  const depot = nav.depotGroup;
  return (
    <nav
      aria-label={depot ? `${depot.heading} pages` : 'Depot management'}
      data-testid="depot-nav-strip"
      className="relative z-30 flex h-[var(--depot-nav-h)] min-w-0 shrink-0 border-b border-depot-line bg-depot-page sm:sticky sm:top-[var(--depot-bar-h)] xl:hidden"
    >
      <ScrollStrip activeKey={pathname} className="min-w-0 flex-1" scrollClassName={SCROLLER}>
        {(depot ? [depot] : nav.networkGroups).map((group, position) => (
          <div
            key={group.heading}
            className={`flex shrink-0 items-center ${position > 0 ? 'border-l border-depot-line pl-4' : ''}`}
          >
            <p className="sr-only">{group.heading}</p>
            <NavLinks items={group.items} pathname={pathname} className="flex" />
          </div>
        ))}
      </ScrollStrip>
    </nav>
  );
}
