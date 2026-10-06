'use client';

import { useId, useState } from 'react';
import { BriefingCard } from '@/components/depot/copilot/BriefingCard';
import type { CopilotScope } from '@/lib/depot/copilot/wire';

/** Hides the card's own label (h2) and the text's headline (h3) under the row's header. */
export const BRIEFING_BODY = '[&_h2]:hidden [&_h3]:hidden';

/**
 * The depot briefing as one collapsed row. Opening it mounts the briefing card in
 * place; closing hides it without unmounting, so a written text is kept.
 */
export function BriefingRow({
  scope,
  feedNow,
}: {
  readonly scope: CopilotScope;
  /** The page's feed time, so the card can say when the page has moved on. */
  readonly feedNow: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const bodyId = useId();
  const toggle = (): void => {
    setMounted(true);
    setOpen((value) => !value);
  };
  return (
    <section aria-labelledby="depot-briefing-row" data-testid="depot-briefing-row" className="min-w-0 border-y border-depot-line">
      <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
        <h2 id="depot-briefing-row" className="depot-label">
          Depot briefing
        </h2>
        <p className="min-w-0 basis-full font-sans text-xs text-depot-muted sm:flex-1 sm:basis-auto sm:truncate">
          A short written summary of these figures. Advisory: it describes, it does not instruct.
        </p>
        <button type="button" className="hud-button shrink-0" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
          {open ? 'Close briefing' : 'Open briefing'}
        </button>
      </div>
      {/* One heading per opened panel: the row's label is the header, so the card's own
          label and its headline are not drawn and the box starts with the paragraphs. */}
      <div id={bodyId} hidden={!open} className={`pb-3 ${BRIEFING_BODY}`}>
        {mounted ? <BriefingCard scope={scope} title="Depot briefing" currentFeedTime={feedNow} /> : null}
      </div>
    </section>
  );
}
