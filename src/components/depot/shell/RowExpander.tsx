'use client';

import { useCallback, useState } from 'react';
import { DisclosureChevron } from './DisclosureChevron';

export interface ExpandedRows {
  readonly isOpen: (key: string) => boolean;
  readonly toggle: (key: string) => void;
}

/** Which rows are open: one at a time unless `multiple`; a new Set on every change. */
export function useExpandedRows(multiple: boolean): ExpandedRows {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback(
    (key: string): void =>
      setOpen((current) => {
        if (current.has(key)) return new Set([...current].filter((k) => k !== key));
        return multiple ? new Set([...current, key]) : new Set([key]);
      }),
    [multiple],
  );
  return { isOpen: (key) => open.has(key), toggle };
}

/** The id of a row's expanded content, for `aria-controls`. */
export function expandedRowId(tableId: string, key: string): string {
  return `${tableId}-expanded-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/**
 * The disclosure button in the expander column: a real button, so keyboard and
 * assistive technology work as usual. It does not select the row it sits in.
 */
export function ExpandToggle(props: {
  readonly open: boolean;
  readonly controls: string;
  readonly label: string;
  readonly onToggle: () => void;
}) {
  const { open, controls, label, onToggle } = props;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="inline-flex h-6 w-6 items-center justify-center text-depot-muted hover:text-depot-ink"
    >
      <DisclosureChevron open={open} />
    </button>
  );
}
