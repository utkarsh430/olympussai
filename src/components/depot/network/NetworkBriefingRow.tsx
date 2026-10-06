'use client';

import { useId, useState } from 'react';
import { BriefingCard } from '@/components/depot/copilot/BriefingCard';
import type { CopilotScope } from '@/lib/depot/copilot/wire';

/** Module-level so the card's request body keeps one identity across polls. */
const NETWORK_SCOPE: CopilotScope = { kind: 'network' };

/**
 * The network briefing as the cockpit's row (`cockpit/BriefingRow.tsx`): label, one
 * sentence, "Open briefing". From 640 px they share one line; on a phone they stack, the
 * sentence whole on its own line and the button on the next. Opening mounts the card in
 * place, embedded (no label of its own, no headline: the row's label is the one heading of
 * the opened panel); closing hides it without unmounting, so a written text is kept. The
 * card is given the page's feed time, so its footer says when the page has moved on.
 */
export function NetworkBriefingRow({ feedNow }: { readonly feedNow: string | null }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const bodyId = useId();
  const toggle = (): void => {
    setMounted(true);
    setOpen((value) => !value);
  };
  return (
    <section
      aria-labelledby="network-briefing-row"
      data-testid="depot-briefing-row"
      className="min-w-0 border-y border-depot-line"
    >
      <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
        <h2 id="network-briefing-row" className="depot-label">
          Network briefing
        </h2>
        <p
          data-testid="depot-briefing-row-sentence"
          className="min-w-0 basis-full font-sans text-xs text-depot-prose sm:flex-1 sm:basis-auto sm:truncate"
        >
          A short written summary of these figures. Advisory: it describes, it does not instruct.
        </p>
        <button
          type="button"
          className="hud-button shrink-0"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          {open ? 'Close briefing' : 'Open briefing'}
        </button>
      </div>
      {/* The attribute, with no display class beside it: a closed card keeps its text. */}
      <div id={bodyId} hidden={!open} className="pb-3">
        {mounted ? (
          <BriefingCard
            scope={NETWORK_SCOPE}
            title="Network briefing"
            currentFeedTime={feedNow}
            embedded
          />
        ) : null}
      </div>
    </section>
  );
}
