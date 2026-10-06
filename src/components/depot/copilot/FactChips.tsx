'use client';

import { useId, useState } from 'react';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { groupFactsByProvenance } from '@/lib/depot/copilot/ui/copilotView';
import type { CopilotFactView } from '@/lib/depot/copilot/wire';

export interface FactChipsProps {
  readonly facts: readonly CopilotFactView[];
}

/**
 * The figures the text relied on, behind a disclosure so the text stays the
 * focus. Listed by provenance so MODELLED figures sit together, and every row
 * carries its provenance word.
 */
export function FactChips({ facts }: FactChipsProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (facts.length === 0) {
    return <p className="depot-prose">No figures were used for this text.</p>;
  }
  return (
    <div data-testid="copilot-facts" className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="depot-label cursor-pointer select-none text-left hover:text-depot-ink"
      >
        Figures used: {facts.length}
      </button>
      {open ? <FactList id={listId} facts={facts} /> : null}
    </div>
  );
}


/** The figures as a list, grouped by provenance, each row with its provenance word. */
export function FactList({ id, facts }: { readonly id: string; readonly facts: readonly CopilotFactView[] }) {
  const rows = groupFactsByProvenance(facts).flatMap((group) => group.facts);
  return (
    <ul id={id} className="mt-2 flex flex-col gap-1">
      {rows.map((fact, index) => (
        <li
          key={`${fact.id}-${index}`}
          className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-depot-line py-1"
        >
          <span className="min-w-0 break-words font-mono text-[12px] text-depot-muted">
            {fact.label}
          </span>
          <span className="min-w-0 break-words font-mono text-[13px] tabular-nums text-depot-ink">
            {fact.text}
          </span>
          <ProvenanceBadge provenance={fact.provenance} />
        </li>
      ))}
    </ul>
  );
}
