import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  /** The visible label; the whole row is the hit target. */
  readonly label: React.ReactNode;
}

/**
 * A themed checkbox (no browser-default white controls). The
 * native input is kept, so keyboard, form and screen-reader behaviour are the
 * browser's own; it is drawn in the dark colour scheme with the cyan accent.
 */
export function Checkbox({ label, ...input }: CheckboxProps) {
  return (
    <label className="inline-flex min-w-0 cursor-pointer items-center gap-2 font-mono text-[13px] text-depot-ink">
      <input type="checkbox" {...input} className="depot-checkbox" />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'id'> {
  readonly label: string;
  /** Read the label to screen readers only, when the row already says what it is. */
  readonly hideLabel?: boolean;
  /** `option` elements. */
  readonly children: React.ReactNode;
}

/**
 * A themed select, 32px high in mono 12px like every filter control, with a muted chevron in place of the
 * browser's white one. A native `select`, so the option list, keyboard and screen
 * readers behave natively; the dark colour scheme keeps the open list dark too.
 */
export function Select({ label, hideLabel = false, children, ...select }: SelectProps) {
  const id = useId();
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'depot-label'}>
        {label}
      </label>
      <span className="relative inline-flex min-w-0">
        <select id={id} {...select} className="depot-control depot-select min-w-0">
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-depot-muted"
        />
      </span>
    </span>
  );
}

export interface FilterRowProps {
  /** Names the group of filters for assistive technology ("Filter depots"). */
  readonly label: string;
  /** `SearchField`, `Select` and `Checkbox` controls, in reading order. */
  readonly children: React.ReactNode;
}

/**
 * The one filter-row pattern: each control's label inline at
 * its left in mono 11px, every control 32px high, the row wrapping on a narrow column.
 * League, routes and exceptions share it; a page puts it directly above its table.
 */
export function FilterRow({ label, children }: FilterRowProps) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid="depot-filter-row"
      className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2"
    >
      {children}
    </div>
  );
}

export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'id'> {
  readonly label: string;
  /** Read the label to screen readers only, when the row already says what it is. */
  readonly hideLabel?: boolean;
}

/** A search box in the filter-row style: inline label at the left, a 32px mono field. */
export function SearchField({ label, hideLabel = false, ...input }: SearchFieldProps) {
  const id = useId();
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'depot-label'}>
        {label}
      </label>
      <input id={id} type="search" {...input} className="depot-control w-48 min-w-0 max-w-full" />
    </span>
  );
}
