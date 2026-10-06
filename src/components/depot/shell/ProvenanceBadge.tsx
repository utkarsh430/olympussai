import { PROVENANCE_LABEL } from '@/lib/depot/labels';
import type { Coverage, Provenance } from '@/lib/depot/types';

/**
 * Hairline, wash and text per provenance, the command centre's badge colours (LIVE green,
 * MODELLED amber, DERIVED cyan, REFERENCE slate); the word carries the meaning.
 */
const TONE: Readonly<Record<Provenance, string>> = {
  live: 'border-alert-green/45 bg-alert-green/10 text-alert-green',
  derived: 'border-holo-glow/40 bg-holo-glow/10 text-holo-glow',
  modelled: 'border-alert-amber/50 bg-alert-amber/10 text-alert-amber',
  reference: 'border-slate-400/40 bg-slate-400/10 text-slate-400',
};

export interface ProvenanceBadgeProps {
  readonly provenance: Provenance;
  /** How much of the population the figure rests on, shown as "n of N". */
  readonly coverage?: Coverage;
  /** The pill shape of the ruled places: a section label, a column header, the provenance line. */
  readonly pill?: boolean;
}

/**
 * Tag stating where a figure comes from: LIVE, DERIVED, MODELLED or REFERENCE.
 * With `coverage`, the sample size follows the word ("DERIVED 112 of 143").
 */
export function ProvenanceBadge({ provenance, coverage, pill = false }: ProvenanceBadgeProps) {
  return (
    <span
      data-testid="depot-provenance"
      data-provenance={provenance}
      className={`depot-tag ${pill ? 'depot-tag-pill ' : ''}${TONE[provenance]}`}
    >
      {PROVENANCE_LABEL[provenance]}
      {coverage ? ' ' : null}
      {coverage ? (
        <span className="font-normal normal-case tracking-normal tabular-nums">
          {coverage.n} of {coverage.of}
        </span>
      ) : null}
    </span>
  );
}
