'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Menu } from 'lucide-react';
import { DepotSignOut } from './DepotSignOut';

/**
 * The phone top bar's one menu (under 640px): Operations and Sign out behind a real
 * button with `aria-expanded`. The panel is rendered only while open (a `hidden`
 * attribute would lose to a display class) and is positioned against the bar, so it
 * never widens the page. Escape closes it and returns focus to the button.
 */
export function DepotBarMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || !open) return;
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="sm:hidden" onKeyDown={onKeyDown} data-testid="depot-bar-menu">
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
          className="absolute inset-x-0 top-full z-50 flex flex-wrap items-center gap-2 border-b border-depot-line bg-depot-page px-4 py-3"
        >
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
