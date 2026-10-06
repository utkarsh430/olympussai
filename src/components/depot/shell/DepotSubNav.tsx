'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { depotNav, isDepotNavItemActive } from '@/lib/depot/depotNav';

export interface DepotSubNavProps {
  readonly depotId: string;
}

/**
 * The pages of one depot (cockpit, roster, yard) as a strip above the page. The
 * active page is marked like the left rail's active item: a 2px cyan edge and the
 * raised surface, plus `aria-current`. The strip scrolls inside itself on a narrow
 * column, so the page never scrolls sideways; focus rings are drawn inside each
 * link for the same reason the rail draws them inside.
 */
export function DepotSubNav({ depotId }: DepotSubNavProps) {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="Depot pages"
      data-testid="depot-sub-nav"
      className="mb-6 flex min-w-0 overflow-x-auto border-b border-depot-line"
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
    </nav>
  );
}
