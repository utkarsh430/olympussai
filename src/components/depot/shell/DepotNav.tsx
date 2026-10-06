'use client';

import { usePathname } from 'next/navigation';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { railGroups, shellNav } from '@/lib/depot/shellModel';
import { DepotNavStrip } from './DepotNavStrip';
import { NavLinks } from './NavLinks';

/**
 * The shell's navigation (rulings, section 4), one model (`shellNav`) in two forms:
 *
 * - From 1280px (Tailwind `xl`), the left rail, 232px wide. The `<nav>` is stretched by the flex row to the full
 *   height of the page, so its surface and right hairline run from under the bar to the
 *   footer however short the link list is; inside it the links sit in a sticky column
 *   capped at the viewport below the bar, which scrolls inside itself when a short
 *   viewport cannot hold them. In depot scope it leads with the depot's name as a group
 *   heading and that depot's pages, then the network groups. There are no depot tabs.
 * - Below 1280px, ONE strip under the top bar (`DepotNavStrip`), so at 1024 the content
 *   column is the full width less the page gutters (976px) rather than losing 200px to
 *   a rail.
 *
 * Each form is `display: none` at the other's widths, so only one is ever in the
 * accessibility tree and in the tab order. An unknown depot has no depot group.
 */
export function DepotNav() {
  const pathname = usePathname() ?? '';
  const { data } = useDepotNetworkContext();
  const nav = shellNav(pathname, data?.depots ?? null);

  return (
    <>
      <nav
        aria-label="Depot management"
        data-testid="depot-nav"
        className="hidden shrink-0 border-r border-depot-line bg-depot-page xl:block xl:w-[232px]"
      >
        <div
          data-testid="depot-nav-column"
          className="sticky top-[var(--depot-bar-h)] z-30 flex max-h-[calc(100dvh-var(--depot-bar-h))] flex-col gap-5 overflow-y-auto py-5"
        >
          {railGroups(nav).map((group, position) => (
            <div
              key={`${position}-${group.heading}`}
              data-testid={position === 0 && nav.depotGroup ? 'depot-nav-depot-group' : undefined}
            >
              {/* A label, not a sentence: a div keeps it out of the prose rule. */}
              <div
                className={`depot-label mb-1.5 truncate px-4 ${
                  position === 0 && nav.depotGroup ? 'text-depot-ink' : ''
                }`}
              >
                {group.heading}
              </div>
              <NavLinks items={group.items} pathname={pathname} />
            </div>
          ))}
        </div>
      </nav>
      <DepotNavStrip nav={nav} pathname={pathname} />
    </>
  );
}
