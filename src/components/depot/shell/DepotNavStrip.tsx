'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ShellNav } from '@/lib/depot/shellModel';
import { NavLinks } from './NavLinks';
import { ScrollStrip } from './ScrollStrip';

const SCROLLER =
  'flex h-full items-center gap-4 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * The single navigation strip below 900px. In depot scope it shows the depot's pages,
 * with a "Network" disclosure at its left (a real button with `aria-expanded`) that
 * opens the network links in a panel under the strip; in network scope it shows the
 * network links. It scrolls inside itself with the existing edge cue and centres the
 * active link (`ScrollStrip`). It sticks under the bar from 640px (`--depot-bar-h`) at
 * `--depot-nav-h`; the panel is positioned against the strip, so it never adds height.
 */
export function DepotNavStrip({ nav, pathname }: { readonly nav: ShellNav; readonly pathname: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);

  // A link in the panel leads to a new page: close it there.
  useEffect(() => setOpen(false), [pathname]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || !open) return;
    setOpen(false);
    button.current?.focus();
  };

  const depot = nav.depotGroup;
  return (
    <nav
      aria-label={depot ? `${depot.heading} pages` : 'Depot management'}
      data-testid="depot-nav-strip"
      onKeyDown={onKeyDown}
      className="relative z-30 flex h-[var(--depot-nav-h)] min-w-0 shrink-0 border-b border-depot-line bg-depot-page sm:sticky sm:top-[var(--depot-bar-h)] min-[900px]:hidden"
    >
      {depot ? (
        <button
          ref={button}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((value) => !value)}
          className="depot-nav-link shrink-0 border-r border-r-depot-line focus-visible:outline-offset-[-2px]"
        >
          Network
        </button>
      ) : null}
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
      {depot && open ? (
        <div
          id={panelId}
          data-testid="depot-nav-network-panel"
          className="absolute inset-x-0 top-full flex flex-col gap-3 border-b border-depot-line bg-depot-page py-3"
        >
          {nav.networkGroups.map((group) => (
            <div key={group.heading}>
              <p className="depot-label mb-1 px-4">{group.heading}</p>
              <NavLinks items={group.items} pathname={pathname} className="flex flex-wrap" />
            </div>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
