'use client';

import { Disclosure } from '@/components/depot/rebalance/Disclosure';
import {
  DEAD_KM_MEANING,
  TRIPS_MODELLED_NOTE,
  allocationHeadline,
  paramsSentence,
} from '@/lib/depot/routes/allocationWording';
import type { DepotAllocationResponse } from '@/lib/depot/routes/api';

/**
 * The page's closing disclosure: everything the plan panel used to say in seven blocks,
 * said once (depot positions, dead kilometres, trips, the thresholds, the coverage and the
 * counts of routes that stay or fall outside the plan).
 */
export function RoutesMethod({ allocation }: { readonly allocation: DepotAllocationResponse | null }) {
  const h = allocation === null ? null : allocationHeadline(allocation);
  return (
    <Disclosure label="How these figures are produced" testId="routes-method">
      <div className="depot-prose flex max-w-3xl flex-col gap-2 text-[13px]">
        {h ? <p>{h.positionsLine} {DEAD_KM_MEANING}</p> : <p>{DEAD_KM_MEANING}</p>}
        {allocation ? (
          <p>
            {allocation.tripDefinition} {TRIPS_MODELLED_NOTE}
          </p>
        ) : (
          <p>{TRIPS_MODELLED_NOTE}</p>
        )}
        {allocation ? <p>{paramsSentence(allocation.params)}</p> : null}
        {h ? <p>{h.coverageLine}</p> : null}
        {h?.stayLine ? <p>{h.stayLine}</p> : null}
        {h?.excludedLine ? <p>{h.excludedLine}</p> : null}
      </div>
    </Disclosure>
  );
}
