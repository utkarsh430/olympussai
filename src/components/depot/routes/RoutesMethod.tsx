'use client';

import { HowProduced } from '@/components/depot/shell/HowProduced';
import {
  DEAD_KM_MEANING,
  PROFILES_GROW_WITH_USE,
  TRIPS_MODELLED_NOTE,
  allocationHeadline,
  paramsSentence,
} from '@/lib/depot/routes/allocationWording';
import type { DepotAllocationResponse } from '@/lib/depot/routes/api';
import { UPSTREAM_COST } from '@/lib/depot/routes/profileLoader';

/**
 * The page's closing disclosure: everything the plan panel used to say, said once (depot
 * positions, dead kilometres, trips, the thresholds, how route details are fetched and
 * what each costs, the coverage and the counts of routes that stay or fall outside the
 * plan). Rendered in every state, so how details are fetched is never lost (M8).
 */
export function RoutesMethod({ allocation }: { readonly allocation: DepotAllocationResponse | null }) {
  const h = allocation === null ? null : allocationHeadline(allocation);
  return (
    <HowProduced testId="routes-method">
      <p className="depot-prose">{h ? `${h.positionsLine} ${DEAD_KM_MEANING}` : DEAD_KM_MEANING}</p>
      <p className="depot-prose">
        {allocation ? `${allocation.tripDefinition} ${TRIPS_MODELLED_NOTE}` : TRIPS_MODELLED_NOTE}
      </p>
      {allocation ? <p className="depot-prose">{paramsSentence(allocation.params)}</p> : null}
      <p className="depot-prose">{`${PROFILES_GROW_WITH_USE} ${UPSTREAM_COST}`}</p>
      {h ? <p className="depot-prose">{h.coverageLine}</p> : null}
      {h?.stayLine ? <p className="depot-prose">{h.stayLine}</p> : null}
      {h?.excludedLine ? <p className="depot-prose">{h.excludedLine}</p> : null}
    </HowProduced>
  );
}
