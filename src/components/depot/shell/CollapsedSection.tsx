'use client';

import { useId, useState, type ReactNode, type Ref } from 'react';
import { formatCount } from '@/lib/depot/format';

export interface CollapsedSectionProps {
  readonly label: string;
  /**
   * `section` (default): the toggle sits inside the section's `h2`, styled as a section
   * label. `row`: a plain toggle line inside a section that already has its heading.
   */
  readonly variant?: 'section' | 'row';
  readonly count?: number;
  /** One muted line on the right of the heading (section variant). */
  readonly note?: string;
  /** Controlled when given (with `onToggle`); closed by default otherwise. */
  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;
  /** Heading id and ref: a focus target (the heading takes focus programmatically). */
  readonly headingId?: string;
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly testId?: string;
  /**
   * Keep the content mounted while closed, for content whose state must survive closing
   * (typed fields) or that a closed `<details>` used to keep in the markup. The closed
   * wrapper carries only the `hidden` display class, never the `hidden` attribute, so no
   * display class can override it. Otherwise closed content is not rendered.
   */
  readonly keepMounted?: boolean;
  readonly children: ReactNode;
}

function Toggle(props: {
  readonly open: boolean;
  readonly panelId: string;
  readonly onClick: () => void;
  readonly label: string;
  readonly count?: number;
  readonly row: boolean;
}) {
  const { open, panelId, onClick, label, count, row } = props;
  const look = row
    ? 'py-1 font-sans text-sm text-depot-muted'
    : 'font-mono text-[11px] uppercase tracking-[0.16em] text-depot-muted';
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onClick}
      className={`inline-flex min-w-0 items-baseline gap-2 text-left hover:text-depot-ink ${look}`}
    >
      <span aria-hidden className={`inline-block w-3 text-depot-faint ${open ? 'rotate-90' : ''}`}>
        ›
      </span>
      <span className="min-w-0">
        {label}
        {count !== undefined ? <span className="tabular-nums"> · {formatCount(count)}</span> : null}
      </span>
    </button>
  );
}

/**
 * A closed part of a page that opens from a real button (`aria-expanded`,
 * `aria-controls`): a whole section opening from its heading, or a row inside a section.
 * Keyboard operable as any button. Closed content is not rendered unless `keepMounted`.
 */
export function CollapsedSection(props: CollapsedSectionProps) {
  const { label, count, note, headingId, headingRef, testId, children } = props;
  const { variant = 'section', keepMounted = false } = props;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const panelId = useId();
  const row = variant === 'row';

  function toggle(): void {
    const next = !open;
    if (props.onToggle) props.onToggle(next);
    else setOwnOpen(next);
  }

  const button = (
    <Toggle open={open} panelId={panelId} onClick={toggle} label={label} count={count} row={row} />
  );
  const content =
    keepMounted || open ? (
      <div id={panelId} className={open ? undefined : 'hidden'}>
        {children}
      </div>
    ) : null;

  if (row) {
    return (
      <div data-testid={testId} className="min-w-0">
        {button}
        {content}
      </div>
    );
  }
  return (
    <section aria-labelledby={headingId} data-testid={testId} className="min-w-0">
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-depot-line pt-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 scroll-mt-[var(--depot-anchor-mt)] font-mono text-[11px] font-normal"
        >
          {button}
        </h2>
        {note ? <p className="min-w-0 font-sans text-[13px] text-depot-muted">{note}</p> : null}
      </div>
      {content}
    </section>
  );
}
