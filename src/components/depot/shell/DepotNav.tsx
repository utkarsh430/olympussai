'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, type DepotNavGroup } from '@/lib/depot/nav';

/**
 * Grouped navigation rail. A sticky column beside the content from 900px up;
 * below that it becomes a horizontally scrolling strip under the top bar so the
 * page itself never scrolls sideways. Focus rings are drawn inside each link
 * because the rail's own overflow would clip an outset ring.
 */
export function DepotNav({ groups }: { readonly groups: readonly DepotNavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Depot management"
      data-testid="depot-nav"
      className="sticky top-14 z-30 flex shrink-0 gap-6 overflow-x-auto border-b border-depot-line bg-depot-page px-2 py-2 min-[900px]:h-[calc(100dvh-3.5rem)] min-[900px]:w-[200px] min-[900px]:flex-col min-[900px]:gap-5 min-[900px]:overflow-y-auto min-[900px]:overflow-x-hidden min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:px-0 min-[900px]:py-5 min-[1280px]:w-[232px]"
    >
      {groups.map((group) => (
        <div key={group.heading} className="flex shrink-0 items-center gap-2 min-[900px]:block">
          <p className="depot-label px-4 min-[900px]:mb-1.5">{group.heading}</p>
          <ul className="flex min-[900px]:block">
            {group.items.map((item) => {
              const active = isNavItemActive(pathname, item);
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
        </div>
      ))}
    </nav>
  );
}
