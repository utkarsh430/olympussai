'use client';

import { useEffect, useRef, useState } from 'react';
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
  readonly placeholder: string;
  readonly parse: (raw: string) => ParseResult;
  /** Called with the value, or null for blank, after a pause or on blur or Enter. */
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
  placeholder,
  parse,
  onCommit,
  className,
}: NumberFieldProps) {
  const [text, setText] = useState('');
  const commitRef = useRef(onCommit);
  const schedulerRef = useRef<CommitScheduler<number | null> | null>(null);

  useEffect(() => {
    commitRef.current = onCommit;
  });
  useEffect(() => {
    const scheduler = createCommitScheduler<number | null>((v) => commitRef.current(v));
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
      <input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        aria-invalid={evaluation.kind === 'invalid'}
        aria-describedby={evaluation.kind === 'invalid' ? errorId : undefined}
        onChange={(e) => change(e.target.value)}
        onBlur={() => schedulerRef.current?.flush()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') schedulerRef.current?.flush();
        }}
        className="depot-field w-32 scroll-mt-[var(--depot-scroll-mt)] placeholder:text-depot-muted"
      />
      {evaluation.kind === 'invalid' ? (
        <p id={errorId} className="text-[11px] text-alert-amber">
          {evaluation.error} {PREVIOUS_VALUE_NOTE}.
        </p>
      ) : null}
    </div>
  );
}
