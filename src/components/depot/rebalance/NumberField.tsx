'use client';

import { useEffect, useRef, useState } from 'react';
import { changeFrom, inForceText } from '@/lib/depot/rebalance/fieldsInForce';
import {
  PREVIOUS_VALUE_NOTE,
  createCommitScheduler,
  evaluateField,
  type CommitScheduler,
} from '@/lib/depot/rebalance/fieldCommit';
import type { ParseResult } from '@/lib/depot/rebalance/scenarioParsers';

export interface NumberFieldProps {
  readonly id: string;
  readonly label: string;
  /** The value in force (the server plan's, or the what-if's): the field starts with it. */
  readonly inForce: number;
  /** Shown after the field ("%", "km", "buses"). */
  readonly unit: string;
  readonly parse: (raw: string) => ParseResult;
  /**
   * Called after a pause or on blur or Enter with the new value, or null when the field is
   * blank or holds the value in force (no change).
   */
  readonly onCommit: (value: number | null) => void;
  readonly className?: string;
}

/**
 * A number the sandbox re-plans with. Typing does not re-plan at once; the
 * value is committed after a pause, or on blur or Enter. While the text is
 * not a usable number the field says the plan still shows the previous value.
 */
export function NumberField({
  id,
  label,
  inForce,
  unit,
  parse,
  onCommit,
  className,
}: NumberFieldProps) {
  const [text, setText] = useState(() => inForceText(inForce));
  const commitRef = useRef(onCommit);
  const inForceRef = useRef(inForce);
  const schedulerRef = useRef<CommitScheduler<number | null> | null>(null);

  useEffect(() => {
    commitRef.current = onCommit;
    inForceRef.current = inForce;
  });
  useEffect(() => {
    const scheduler = createCommitScheduler<number | null>((v) =>
      commitRef.current(changeFrom(v, inForceRef.current)),
    );
    schedulerRef.current = scheduler;
    return () => scheduler.cancel();
  }, []);

  const evaluation = evaluateField(text, parse);
  const errorId = `${id}-error`;

  function change(next: string): void {
    setText(next);
    const result = evaluateField(next, parse);
    if (result.kind === 'invalid') schedulerRef.current?.cancel();
    else schedulerRef.current?.schedule(result.kind === 'valid' ? result.value : null);
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`}>
      <label htmlFor={id} className="depot-label">
        {label}
      </label>
      <span className="flex min-w-0 items-baseline gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={evaluation.kind === 'invalid'}
          aria-describedby={evaluation.kind === 'invalid' ? errorId : undefined}
          onChange={(e) => change(e.target.value)}
          onBlur={() => schedulerRef.current?.flush()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') schedulerRef.current?.flush();
          }}
          className="depot-field w-24 scroll-mt-[var(--depot-scroll-mt)] tabular-nums"
        />
        <span className="font-mono text-[13px] text-depot-muted">{unit}</span>
      </span>
      {evaluation.kind === 'invalid' ? (
        <p id={errorId} className="depot-note text-alert-amber">
          {evaluation.error} {PREVIOUS_VALUE_NOTE}.
        </p>
      ) : null}
    </div>
  );
}
