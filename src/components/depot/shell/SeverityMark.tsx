import type { ExceptionSeverity } from '@/lib/depot/exceptions/types';
import { SEVERITY_LABEL } from '@/lib/depot/labels';

/**
 * Square colour per severity, the same status colours as `BusStateMark` (crimson,
 * amber, muted grey), so a severity and a bus state read alike. The word always follows.
 */
export const SEVERITY_SQUARE: Readonly<Record<ExceptionSeverity, string>> = {
  critical: 'bg-alert-crimson',
  warning: 'bg-alert-amber',
  info: 'bg-depot-muted',
};

export interface SeverityMarkProps {
  readonly severity: ExceptionSeverity;
}

/**
 * A severity wherever one is shown: a 6px square in the
 * status colour, then the word ("Critical", "Warning", "Info") from `labels.ts`. It
 * replaces the plain coloured word, the boxed badge and the lowercase phrase. Never the
 * colour alone, never a box. On a list grouped by severity, put it on the group label and
 * drop it from the rows.
 */
export function SeverityMark({ severity }: SeverityMarkProps) {
  return (
    <span
      data-testid="depot-severity"
      data-severity={severity}
      className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 ${SEVERITY_SQUARE[severity]}`} />
      <span className="truncate">{SEVERITY_LABEL[severity]}</span>
    </span>
  );
}
