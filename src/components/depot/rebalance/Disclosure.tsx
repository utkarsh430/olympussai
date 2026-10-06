'use client';

import { useId, useState, type ReactNode, type Ref } from 'react';
import { formatCount } from '@/lib/depot/format';

export interface DisclosureProps {
  readonly label: string;
  readonly count?: number;
  /** One muted line on the right of the heading. */
  readonly note?: string;
  /** Controlled when given (with `onToggle`); closed by default otherwise. */
  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;
  /** Heading id and ref: a focus target (the heading takes focus programmatically). */
  readonly headingId?: string;
  readonly headingRef?: Ref<HTMLHeadingElement>;
  readonly testId?: string;
  readonly children: ReactNode;
}

/**
 * A section that opens from its heading: a real button with `aria-expanded` inside the
 * section's `h2`, styled as a section label. The content stays mounted while closed (the
 * sandbox's fields keep their typed text) and is hidden with the `hidden` attribute on a
 * wrapper that has no display class of its own.
 */
export function Disclosure(props: DisclosureProps) {
  const { label, count, note, headingId, headingRef, testId, children } = props;
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const panelId = useId();

  function toggle(): void {
    const next = !open;
    if (props.onToggle) props.onToggle(next);
    else setOwnOpen(next);
  }

  return (
    <section aria-labelledby={headingId} data-testid={testId} className="min-w-0">
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-depot-line pt-3">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 scroll-mt-[var(--depot-anchor-mt)] font-mono text-[11px] font-normal uppercase tracking-[0.16em] text-depot-muted"
        >
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
            className="inline-flex min-w-0 items-baseline gap-2 uppercase hover:text-depot-ink"
          >
            <span aria-hidden className="inline-block w-3 text-holo-glow">
              {open ? '−' : '+'}
            </span>
            <span>
              {label}
              {count !== undefined ? (
                <span className="tabular-nums"> · {formatCount(count)}</span>
              ) : null}
            </span>
          </button>
        </h2>
        {note ? <p className="min-w-0 font-sans text-[13px] text-depot-muted">{note}</p> : null}
      </div>
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
