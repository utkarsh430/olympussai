'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, type DepotNavGroup } from '@/lib/depot/nav';

/**
 * Grouped navigation rail. A sticky column beside the content from 900px up;
 * below that it becomes a one-line, horizontally scrolling strip under the top
 * bar so the page itself never scrolls sideways. In the strip the group labels
 * are read to screen readers only and a hairline divides the groups, so no
 * label looks like a link. The rail is capped at the viewport height rather
 * than fixed to it, so a short page (the error state) is not pushed past the
 * viewport by the footer. Focus rings are drawn inside each link
 * because the rail's own overflow would clip an outset ring.
 */
export function DepotNav({ groups }: { readonly groups: readonly DepotNavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Depot management"
      data-testid="depot-nav"
      className="sticky top-14 z-30 flex shrink-0 gap-4 overflow-x-auto border-b border-depot-line bg-depot-page px-2 py-1 min-[900px]:max-h-[calc(100dvh-3.5rem)] min-[900px]:w-[200px] min-[900px]:flex-col min-[900px]:gap-5 min-[900px]:overflow-y-auto min-[900px]:overflow-x-hidden min-[900px]:border-b-0 min-[900px]:border-r min-[900px]:px-0 min-[900px]:py-5 min-[1280px]:w-[232px]"
    >
      {groups.map((group, position) => (
        <div
          key={group.heading}
          className={`flex shrink-0 items-center min-[900px]:block ${
            position > 0
              ? 'border-l border-depot-line pl-4 min-[900px]:border-l-0 min-[900px]:pl-0'
              : ''
          }`}
        >
          <p className="depot-label sr-only px-4 min-[900px]:not-sr-only min-[900px]:mb-1.5">
            {group.heading}
          </p>
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
