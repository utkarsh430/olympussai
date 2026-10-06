'use client';

import { useCallback, useState } from 'react';
import { DisclosureChevron } from './DisclosureChevron';

export interface ExpandedRows {
  readonly isOpen: (key: string) => boolean;
  readonly toggle: (key: string) => void;
}

/** Held by the page: the one open row, and where the table reports a wish to change it. */
export interface ControlledExpansion {
  readonly key: string | null;
  readonly onChange: (key: string | null) => void;
}

/**
 * Which rows are open: one at a time unless `multiple`; a new Set on every change. With
 * `controlled`, the page holds the one open row and the table only reports the wish to
 * change it (a control elsewhere on the page can then open a row).
 */
export function useExpandedRows(
  multiple: boolean,
  initialKey?: string,
  controlled?: ControlledExpansion,
): ExpandedRows {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(initialKey === undefined ? [] : [initialKey]),
  );
  const toggle = useCallback(
    (key: string): void =>
      setOpen((current) => {
        if (current.has(key)) return new Set([...current].filter((k) => k !== key));
        return multiple ? new Set([...current, key]) : new Set([key]);
      }),
    [multiple],
  );
  if (controlled) {
    return {
      isOpen: (key) => controlled.key === key,
      toggle: (key) => controlled.onChange(controlled.key === key ? null : key),
    };
  }
  return { isOpen: (key) => open.has(key), toggle };
}

/** The id of a row's expanded content, for `aria-controls`. */
export function expandedRowId(tableId: string, key: string): string {
  return `${tableId}-expanded-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/**
 * The disclosure chevron in the expander column: a real button, so assistive technology
 * reads its state. It does not select the row it sits in. Where the row itself is the
 * control (`tabIndex` -1), the row takes the one tab stop and the button stays clickable.
 */
export function ExpandToggle(props: {
  readonly open: boolean;
  readonly controls: string;
  readonly label: string;
  readonly onToggle: () => void;
  readonly tabIndex?: number;
}) {
  const { open, controls, label, onToggle, tabIndex } = props;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="inline-flex h-6 w-5 items-center justify-center text-depot-muted hover:text-depot-ink"
    >
      <DisclosureChevron open={open} />
    </button>
  );
}
