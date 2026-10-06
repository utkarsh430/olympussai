import Link from 'next/link';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { ParkingLane, ParkingOrder } from '@/lib/depot/yard/parkingApi';
import {
  blockedSentence,
  dutyText,
  laneHeading,
  overflowReasonText,
  overflowSentence,
  PLAN_NOTICE,
  planDateSentence,
} from '@/lib/depot/yard/parkingModel';

export interface ParkingPlanProps {
  readonly depotId: string;
  readonly order: ParkingOrder;
  /** YYYY-MM-DD the order is for. */
  readonly operatingDate: string;
}

function BusLink({ depotId, registration }: { readonly depotId: string; registration: string }) {
  return (
    <Link href={rosterBusHref(depotId, registration)} className="depot-link font-mono text-[13px]">
      {registration}
    </Link>
  );
}

/** One lane as an ordered list, nearest the exit first; the list is the primary form. */
function LaneList({ depotId, lane }: { readonly depotId: string; readonly lane: ParkingLane }) {
  const headingId = `parking-lane-${lane.id}`;
  return (
    <li className="min-w-0 rounded-md border border-depot-line p-3" data-testid="parking-lane">
      <h4 id={headingId} className="text-[13px] text-depot-ink">
        {laneHeading(lane)}
      </h4>
      {lane.slots.length === 0 ? (
        <p className="depot-prose mt-1 text-xs">No bus is placed in this lane.</p>
      ) : (
        <>
          <p className="depot-prose mt-1 text-xs">From the exit inwards:</p>
          <ol aria-labelledby={headingId} className="mt-1 space-y-0.5">
            {lane.slots.map((slot) => (
              <li key={slot.registrationNumber} className="min-w-0 break-words text-[13px]">
                <span className="tabular-nums text-depot-muted">{slot.position}. </span>
                <BusLink depotId={depotId} registration={slot.registrationNumber} />
                <span className="text-depot-muted">, {dutyText(slot.firstDutyStartMin)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </li>
  );
}

function Overflow({ depotId, order }: { readonly depotId: string; readonly order: ParkingOrder }) {
  if (order.overflow.length === 0) return null;
  return (
    <div className="mt-4" data-testid="parking-overflow">
      <h3 className="depot-section-label">Buses that did not fit</h3>
      <p className="depot-prose text-xs">{overflowSentence(order.overflow.length)}</p>
      <ul className="mt-1 space-y-0.5">
        {order.overflow.map((bus) => (
          <li key={bus.registrationNumber} className="min-w-0 break-words text-[13px]">
            <BusLink depotId={depotId} registration={bus.registrationNumber} />
            <span className="text-depot-muted">
              , {dutyText(bus.firstDutyStartMin)}. {overflowReasonText(bus.reason)}.
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The night parking order as text: each lane from the exit inwards, the buses
 * that did not fit, and whether any bus is blocked in. The whole order is
 * MODELLED (modelled duties, modelled lanes). It is a suggestion only.
 */
export function ParkingPlan({ depotId, order, operatingDate }: ParkingPlanProps) {
  const blocked = blockedSentence(order.blocked);
  return (
    <section
      aria-labelledby="parking-plan-heading"
      data-testid="parking-plan"
      className="depot-panel min-w-0 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="parking-plan-heading" className="depot-section-label !mb-0">
          Night parking order
        </h2>
        <ProvenanceBadge provenance={order.provenance} />
      </div>
      <p className="depot-prose mt-2">{PLAN_NOTICE}</p>
      <p className="depot-prose mt-2 text-xs" data-testid="parking-date">
        {planDateSentence(operatingDate)}
      </p>
      <p
        role={blocked.warning ? 'alert' : 'status'}
        data-testid="parking-blocked"
        className={`mt-2 text-[13px] ${blocked.warning ? 'text-alert-amber' : 'text-depot-ink'}`}
      >
        {blocked.text}
      </p>
      <h3 className="depot-section-label mt-4">Lanes</h3>
      <ul className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        {order.lanes.map((lane) => (
          <LaneList key={lane.id} depotId={depotId} lane={lane} />
        ))}
      </ul>
      <Overflow depotId={depotId} order={order} />
    </section>
  );
}
