'use client';

import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { headerProvenanceNote } from '@/lib/depot/feedChip';
import type { Provenance } from '@/lib/depot/types';
import { ProvenanceBadge } from './ProvenanceBadge';

/**
 * A page header's provenance: the tag, then what it applies to and the feed
 * time, as one line under the page sentence. The note is worded for the tag, so
 * a MODELLED page never reads as live. A client island, so the server-rendered header can carry it.
 */
export function HeaderProvenance({ provenance }: { readonly provenance: Provenance }) {
  const { data, error } = useDepotNetworkContext();
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="depot-header-provenance">
      <ProvenanceBadge provenance={provenance} />
      <span className="font-sans text-[13px] text-depot-muted">
        {headerProvenanceNote(data, error, provenance)}
      </span>
    </div>
  );
}
