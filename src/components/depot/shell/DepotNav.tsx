'use client';

import { usePathname } from 'next/navigation';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { railGroups, shellNav } from '@/lib/depot/shellModel';
import { DepotNavStrip } from './DepotNavStrip';
import { NavLinks } from './NavLinks';

/**
 * The shell's navigation (rulings, section 4), one model (`shellNav`) in two forms:
 *
 * - From 900px, the left rail: a sticky column beside the page, capped at what remains
 *   of the viewport. In depot scope it leads with the depot's name as a group heading
 *   and that depot's pages, then the network groups. There are no depot tabs.
 * - Below 900px, ONE strip under the top bar (`DepotNavStrip`).
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
        className="hidden shrink-0 border-r border-depot-line bg-depot-page min-[900px]:sticky min-[900px]:top-[var(--depot-bar-h)] min-[900px]:z-30 min-[900px]:block min-[900px]:max-h-[calc(100dvh-var(--depot-bar-h))] min-[900px]:w-[200px] min-[900px]:self-start min-[900px]:overflow-y-auto min-[1280px]:w-[232px]"
      >
        <div className="flex flex-col gap-5 py-5">
          {railGroups(nav).map((group, position) => (
            <div
              key={`${position}-${group.heading}`}
              data-testid={position === 0 && nav.depotGroup ? 'depot-nav-depot-group' : undefined}
            >
              <p
                className={`depot-label mb-1.5 truncate px-4 ${
                  position === 0 && nav.depotGroup ? 'text-depot-ink' : ''
                }`}
              >
                {group.heading}
              </p>
              <NavLinks items={group.items} pathname={pathname} />
            </div>
          ))}
        </div>
      </nav>
      <DepotNavStrip nav={nav} pathname={pathname} />
    </>
  );
}
