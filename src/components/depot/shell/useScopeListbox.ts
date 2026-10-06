'use client';

import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { moveActiveIndex, type ActiveMove } from '@/lib/depot/depotNav';

const MOVE_KEYS: Readonly<Record<string, ActiveMove>> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  Home: 'first',
  End: 'last',
};

export interface ScopeListboxOptions {
  readonly open: boolean;
  /** Options currently shown. */
  readonly count: number;
  readonly optionId: (index: number) => string;
  /** Everything inside it counts as "inside" for pointer-down. */
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly onSelect: (index: number) => void;
  readonly onClose: (returnFocus: boolean) => void;
}

export interface ScopeListbox {
  readonly active: number;
  readonly setActive: (index: number) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Keyboard and pointer behaviour of the scope listbox (WAI-ARIA combobox). Up and
 * Down wrap, Home and End jump, and only a key move scrolls the active option into
 * view, so a hover never moves the list under the pointer. Enter selects, Escape
 * and Tab close and return focus to the trigger (the field unmounts), and
 * Shift+Tab is left to the browser, which moves focus back to the trigger anyway.
 * A pointer-down outside the root closes the list.
 */
export function useScopeListbox({
  open,
  count,
  optionId,
  rootRef,
  onSelect,
  onClose,
}: ScopeListboxOptions): ScopeListbox {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, rootRef, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const move = MOVE_KEYS[event.key];
    if (move) {
      event.preventDefault();
      const next = moveActiveIndex(active, move, count);
      setActive(next);
      if (next >= 0) document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0 && active < count) onSelect(active);
    } else if (event.key === 'Escape' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      onClose(true);
    } else if (event.key === 'Tab') {
      onClose(false);
    }
  };

  return { active, setActive, onKeyDown };
}
