'use client';

import Link from 'next/link';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import {
  provenanceLine,
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
 * The page's provenance line: one tag and one fixed-formula sentence (with a link to
 * Data sources for a modelled page), directly under the header sentence. Use it once
 * per page, through `PageHeader`'s `provenanceLine` prop; it is the page default, so
 * nothing else on the page repeats that tag. A client island reading the feed's clock.
 */
export function ProvenanceLine({ description }: { readonly description: ProvenanceDescription }) {
  const { data, error } = useDepotNetworkContext();
  const line = provenanceLine(description, { data, error });
  return (
    <div
      className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1"
      data-testid="depot-provenance-line"
      data-tone={line.tone}
    >
      <span className={`depot-tag ${PROVENANCE_TONE_CLASS[line.tone]}`}>{line.tag}</span>
      <span className="font-sans text-[13px] text-depot-muted">{line.sentence}</span>
      {line.link ? (
        <Link href={line.link.href} className="depot-link font-sans text-[13px]">
          {line.link.label}
        </Link>
      ) : null}
    </div>
  );
}
