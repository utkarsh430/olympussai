'use client';

import Link from 'next/link';
import { isDepotNavItemActive } from '@/lib/depot/depotNav';
import type { DepotNavItem } from '@/lib/depot/nav';

/**
 * One navigation group's links, marked like the rail's active item (a 2px cyan edge,
 * the raised surface, `aria-current`). Focus rings are drawn inside each link, because
 * a scrolling strip would clip an outset ring.
 */
export function NavLinks({
  items,
  pathname,
  className = '',
}: {
  readonly items: readonly DepotNavItem[];
  readonly pathname: string;
  readonly className?: string;
}) {
  return (
    <ul className={className}>
      {items.map((item) => {
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
  );
}
