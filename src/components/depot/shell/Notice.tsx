export type NoticeStatus = 'info' | 'warning' | 'critical';

const RULE: Readonly<Record<NoticeStatus, string>> = {
  info: 'border-l-holo-glow',
  warning: 'border-l-alert-amber',
  critical: 'border-l-alert-crimson',
};

const WORD_TONE: Readonly<Record<NoticeStatus, string>> = {
  info: 'text-holo-glow',
  warning: 'text-alert-amber',
  critical: 'text-alert-crimson',
};

export interface NoticeProps {
  readonly status: NoticeStatus;
  /** The word before the text; defaults to the status ("WARNING"). */
  readonly word?: string;
  /** One or two sentences. */
  readonly children: React.ReactNode;
}

/**
 * The page's one notice strip: a 2px left rule in the status
 * colour on the surface, the status as a word, then sans 13px text. Never sticky. At
 * most one per page; anything else folds into the provenance line. Only a critical
 * notice interrupts a screen reader.
 */
export function Notice({ status, word, children }: NoticeProps) {
  return (
    <div
      data-testid="depot-notice"
      data-status={status}
      role={status === 'critical' ? 'alert' : undefined}
      className={`mb-6 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 depot-lit border-l-2 bg-depot-surface px-3 py-2 ${RULE[status]}`}
    >
      <span className={`font-mono text-[11px] font-semibold uppercase tracking-[0.12em] ${WORD_TONE[status]}`}>
        {word ?? status.toUpperCase()}
      </span>
      <p className="min-w-0 flex-1 font-sans text-[13px] text-depot-ink">{children}</p>
    </div>
  );
}
