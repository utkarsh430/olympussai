import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> {
  /** The visible label; the whole row is the hit target. */
  readonly label: React.ReactNode;
}

/**
 * A themed checkbox (rulings, section 3: no browser-default white controls). The
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
 * A themed select in the mono field style, with a muted chevron in place of the
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
        <select id={id} {...select} className="depot-field depot-select min-w-0">
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
