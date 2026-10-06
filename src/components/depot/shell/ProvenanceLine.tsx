'use client';

import Link from 'next/link';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import {
  provenanceLine,
  sentenceSegments,
  type ProvenanceDescription,
  type ProvenanceTone,
} from '@/lib/depot/provenanceLine';
import { usePageRefresh } from './PageRefreshNotice';

/** Hairline, wash and text per tone (the badge colours); the word carries the meaning. */
export const PROVENANCE_TONE_CLASS: Readonly<Record<ProvenanceTone, string>> = {
  live: 'border-alert-green/45 bg-alert-green/10 text-alert-green',
  derived: 'border-holo-glow/40 bg-holo-glow/10 text-holo-glow',
  modelled: 'border-alert-amber/50 bg-alert-amber/10 text-alert-amber',
  mixed: 'border-alert-amber/50 bg-alert-amber/10 text-alert-amber',
  reference: 'border-slate-400/40 bg-slate-400/10 text-slate-400',
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
  const page = usePageRefresh();
  const line = provenanceLine(description, { data, error, page });
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
