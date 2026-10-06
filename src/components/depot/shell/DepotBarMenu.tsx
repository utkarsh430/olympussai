'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Menu } from 'lucide-react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { shellNav } from '@/lib/depot/shellModel';
import { DepotSignOut } from './DepotSignOut';
import { NavLinks } from './NavLinks';

/**
 * The top bar's one menu below 1280px: Operations and Sign out behind a real button with
 * `aria-expanded`. In depot scope it also lists every network page, because the strip
 * then shows only the depot's pages: from a depot page the network is the Menu and one
 * link away (the scope switcher's "Network" option is the other way). The panel is
 * rendered only while open (a `hidden` attribute would lose to a display class) and is
 * positioned against the bar, so it never widens the page. Escape closes it and returns
 * focus to the button; following a link closes it.
 */
export function DepotBarMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname() ?? '';
  const { data } = useDepotNetworkContext();
  const nav = shellNav(pathname, data?.depots ?? null);

  useEffect(() => setOpen(false), [pathname]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || !open) return;
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="xl:hidden" onKeyDown={onKeyDown} data-testid="depot-bar-menu">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="depot-bar-button"
      >
        <Menu className="h-3.5 w-3.5" aria-hidden />
        Menu
      </button>
      {open ? (
        <div
          id={panelId}
          data-testid="depot-bar-menu-panel"
          className="absolute inset-x-0 top-full z-50 flex flex-wrap items-center gap-2 border-b border-depot-line bg-depot-page px-4 py-3 sm:px-6"
        >
          {nav.depotGroup ? (
            <nav aria-label="Network pages" className="mb-1 flex basis-full flex-col gap-2">
              {nav.networkGroups.map((group) => (
                <div key={group.heading}>
                  <div className="depot-label mb-1">{group.heading}</div>
                  <NavLinks items={group.items} pathname={pathname} className="-ml-4 flex flex-wrap" />
                </div>
              ))}
            </nav>
          ) : null}
          <Link href="/project/upsrtc" className="depot-bar-button">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Operations
          </Link>
          <DepotSignOut />
        </div>
      ) : null}
    </div>
  );
}
