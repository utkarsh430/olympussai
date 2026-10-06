'use client';

import Link from 'next/link';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import {
  provenanceLine,
  sentenceSegments,
  type ProvenanceDescription,
  type ProvenanceTone,
} from '@/lib/depot/provenanceLine';

/** Hairline and text colour per tone; the word carries the meaning, not the colour. */
export const PROVENANCE_TONE_CLASS: Readonly<Record<ProvenanceTone, string>> = {
  live: 'border-alert-green/50 text-alert-green',
  derived: 'border-holo-glow/50 text-holo-glow',
  modelled: 'border-alert-amber/50 text-alert-amber',
  mixed: 'border-alert-amber/50 text-alert-amber',
  reference: 'border-depot-muted/50 text-depot-muted',
};

/**
 * The page's provenance line: one tag (a pill) and one fixed-formula sentence (with a
 * link to Data sources for a modelled page), directly under the header sentence, sans
 * 12/20. Use it once per page, through `PageHeader`'s `provenanceLine` prop; it is the
 * page default, so nothing else on the page repeats that tag. On stale data the words
 * "last good data" are drawn in the stale tone (the words carry it; the colour only
 * reinforces it). A page on the modelled operating day passes `modelledDay`, placed
 * after the formula, so no context sentence floats above the hero. A client island
 * reading the feed's clock.
 */
export function ProvenanceLine({ description }: { readonly description: ProvenanceDescription }) {
  const { data, error } = useDepotNetworkContext();
  const line = provenanceLine(description, { data, error });
  return (
    <div
      className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-sans text-xs leading-5"
      data-testid="depot-provenance-line"
      data-tone={line.tone}
    >
      <span className={`depot-tag depot-tag-pill ${PROVENANCE_TONE_CLASS[line.tone]}`}>
        {line.tag}
      </span>
      <span className="text-depot-muted">
        {sentenceSegments(line.sentence, line.staleWords).map((part, index) =>
          part.stale ? (
            <span
              key={index}
              data-testid="depot-provenance-stale"
              className="font-semibold text-alert-amber"
            >
              {part.text}
            </span>
          ) : (
            part.text
          ),
        )}
      </span>
      {line.context ? (
        <span data-testid="depot-provenance-context" className="text-depot-muted">
          {line.context}
        </span>
      ) : null}
      {line.link ? (
        <Link href={line.link.href} className="depot-link">
          {line.link.label}
        </Link>
      ) : null}
    </div>
  );
}
