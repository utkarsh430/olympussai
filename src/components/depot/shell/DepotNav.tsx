'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, type DepotNavGroup } from '@/lib/depot/nav';
import { ScrollStrip } from './ScrollStrip';

/**
 * Grouped navigation rail. A sticky column beside the content from 900px up;
 * below that it becomes a one-line strip under the top bar that scrolls sideways
 * inside itself (`ScrollStrip`: an arrow cap shows where more links follow, and the
 * active link is scrolled into view), so the page itself never scrolls sideways.
 * The strip sticks below the bar from 640px, at the height the shell's custom
 * properties give it (`--depot-bar-h`, `--depot-nav-h`); the rail sticks at the
 * bar's height and is capped at what remains of the viewport, so a short page
 * (the error state) is not pushed past the viewport by the footer. In the strip
 * the group labels are read to screen readers only and a hairline divides the
 * groups; in the rail the labels share the links' 16px inset. Focus rings are
 * drawn inside each link because the scroller's overflow would clip an outset ring.
 */
export function DepotNav({ groups }: { readonly groups: readonly DepotNavGroup[] }) {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="Depot management"
      data-testid="depot-nav"
      className="z-30 flex h-[var(--depot-nav-h)] shrink-0 border-b border-depot-line bg-depot-page sm:sticky sm:top-[var(--depot-bar-h)] min-[900px]:w-[200px] min-[900px]:self-start min-[900px]:border-b-0 min-[900px]:border-r min-[1280px]:w-[232px]"
    >
      <ScrollStrip
        activeKey={pathname}
        className="min-w-0 flex-1"
        cueClassName="min-[900px]:hidden"
        scrollClassName="flex h-full items-center gap-4 overflow-x-auto px-2 max-[899px]:[scrollbar-width:none] max-[899px]:[&::-webkit-scrollbar]:hidden min-[900px]:max-h-[calc(100dvh-var(--depot-bar-h))] min-[900px]:flex-col min-[900px]:items-stretch min-[900px]:gap-5 min-[900px]:overflow-x-hidden min-[900px]:overflow-y-auto min-[900px]:px-0 min-[900px]:py-5"
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
            <p className="depot-label sr-only min-[900px]:not-sr-only min-[900px]:mb-1.5 min-[900px]:px-4">
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
      </ScrollStrip>
    </nav>
  );
}
