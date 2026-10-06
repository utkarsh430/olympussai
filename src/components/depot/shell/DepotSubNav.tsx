'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { depotNav, isDepotNavItemActive } from '@/lib/depot/depotNav';
import { depotScopeState } from '@/lib/depot/scopeState';
import { ScrollStrip } from './ScrollStrip';

export interface DepotSubNavProps {
  readonly depotId: string;
}

/**
 * The pages of one depot (cockpit, roster, yard) as a strip above the page. It sticks
 * directly below whatever is sticky above it (`--depot-sticky-top`), so a depot
 * manager can change page after scrolling. The active page is marked like the left
 * rail's active item: a 2px cyan edge and the raised surface, plus `aria-current`. The
 * strip scrolls inside itself on a narrow column (an arrow cap shows where more tabs
 * follow), so the page never scrolls sideways; focus rings are drawn inside each link
 * for the same reason the rail draws them inside. For a depot the feed does not know
 * (`depotScopeState`) it renders nothing, so no tab leads to a page that cannot exist.
 */
export function DepotSubNav({ depotId }: DepotSubNavProps) {
  const pathname = usePathname() ?? '';
  const network = useDepotNetworkContext();
  const detail = useDepotDetailContext();
  const scope = depotScopeState({
    depotId,
    depots: network.data?.depots ?? null,
    detailError: detail.error,
  });

  // A depot the feed does not know has no pages to go to: render no tabs at all.
  if (!scope.known) return null;

  return (
    <nav
      aria-label="Depot pages"
      data-testid="depot-sub-nav"
      className="sticky top-[var(--depot-sticky-top)] z-20 mb-6 h-[var(--depot-subnav-h)] min-w-0 border-b border-depot-line bg-depot-page"
    >
      <ScrollStrip
        activeKey={pathname}
        className="h-full"
        scrollClassName="flex h-full items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ul className="flex">
          {depotNav(depotId).map((item) => {
            const active = isDepotNavItemActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`depot-nav-link whitespace-nowrap focus-visible:outline-offset-[-2px] ${
                    active ? 'depot-nav-link-active' : ''
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </ScrollStrip>
    </nav>
  );
}
