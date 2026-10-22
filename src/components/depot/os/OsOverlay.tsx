'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { depotPortalRoot } from '@/lib/depot/portalRoot';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface OsOverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly label: string;
  /** 'drawer' slides from the right edge, 'nav' from the left; 'dialog' sits near the top centre. */
  readonly variant: 'drawer' | 'nav' | 'dialog';
  readonly children: ReactNode;
  readonly widthClass?: string;
  readonly testId?: string;
}

/**
 * A modal surface portalled into the shell: Escape and the backdrop close it, Tab stays
 * inside it, and focus returns to what opened it.
 */
export function OsOverlay({ open, onClose, label, variant, children, widthClass, testId }: OsOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const dialog = (
    <div className="fixed inset-0 z-[120]" data-testid={testId}>
      <div className="absolute inset-0 bg-void/70 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={
          variant === 'drawer'
            ? `os-panel os-panel-strong os-drawer-in absolute inset-y-0 right-0 flex w-full flex-col rounded-none border-y-0 border-r-0 ${widthClass ?? 'sm:w-[34rem]'}`
            : variant === 'nav'
              ? `os-panel os-panel-strong os-nav-in absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col rounded-none border-y-0 border-l-0`
              : `os-panel os-dialog-in os-panel-strong absolute left-1/2 top-[8vh] flex max-h-[80vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col ${widthClass ?? 'sm:w-[40rem]'}`
        }
      >
        {children}
      </div>
    </div>
  );
  return createPortal(dialog, depotPortalRoot());
}

export function OverlayClose({ onClose, label = 'Close' }: { readonly onClose: () => void; readonly label?: string }) {
  return (
    <button type="button" onClick={onClose} aria-label={label} className="os-button os-button-quiet h-8 w-8 px-0">
      <X className="h-4 w-4" aria-hidden />
    </button>
  );
}
