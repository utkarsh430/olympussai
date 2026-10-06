import Link from 'next/link';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { CollapsedSection } from '@/components/depot/shell/CollapsedSection';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { ParkingLane, ParkingOrder } from '@/lib/depot/yard/parkingApi';
import {
  buildParkingDiagram,
  LANE_H_PX,
  LANE_LABEL_W_PX,
  SLOT_W_PX,
  type DiagramLane,
} from '@/lib/depot/yard/parkingDiagram';
import {
  dutyText,
  laneHeading,
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

/** One lane as a strip of places, the exit on the left. Geometry is the model's. */
function LaneStrip({ lane }: { readonly lane: DiagramLane }) {
  return (
    <div
      data-testid="parking-lane"
      className="absolute left-0"
      style={{ top: lane.topPx, width: lane.widthPx, height: LANE_H_PX }}
      title={lane.heading}
    >
      <span
        className="absolute left-0 top-0 flex items-center font-mono text-[11px] text-depot-muted"
        style={{ width: LANE_LABEL_W_PX, height: LANE_H_PX }}
      >
        {lane.id}
      </span>
      {lane.slots.map((slot) => (
        <span
          key={slot.position}
          title={slot.title}
          data-filled={slot.registration !== null}
          className={`absolute top-0 flex items-center justify-between gap-1 rounded-[2px] px-1.5 font-mono text-[11px] tabular-nums ${
            slot.registration === null
              ? 'border border-dashed border-depot-line text-depot-faint'
              : 'border border-holo-glow/50 bg-holo-glow/10 text-depot-ink'
          }`}
          style={{ left: slot.leftPx, width: SLOT_W_PX, height: LANE_H_PX }}
        >
          {slot.registration === null ? (
            <span>{slot.position}</span>
          ) : (
            <>
              <span>{slot.shortReg}</span>
              <span className="text-depot-muted">{slot.timeText}</span>
            </>
          )}
        </span>
      ))}
    </div>
  );
}

/** The diagram's text equivalent: each lane from the exit inwards, as before. */
function LaneList({ depotId, lane }: { readonly depotId: string; readonly lane: ParkingLane }) {
  return (
    <li className="min-w-0 py-1 text-[13px]">
      <span className="text-depot-ink">{laneHeading(lane)}</span>
      {lane.slots.length === 0 ? (
        <span className="text-depot-muted">. No bus is placed in this lane.</span>
      ) : (
        <ol className="ml-4 mt-0.5 space-y-0.5">
          {lane.slots.map((slot) => (
            <li key={slot.registrationNumber} className="min-w-0 break-words">
              <span className="tabular-nums text-depot-muted">{slot.position}. </span>
              <BusLink depotId={depotId} registration={slot.registrationNumber} />
              <span className="text-depot-muted">, {dutyText(slot.firstDutyStartMin)}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * The night parking order as one lane diagram: a strip of numbered places per lane,
 * the exit on the left, each filled place a short registration and its first duty.
 * The list in the closed disclosure says the same in words. MODELLED once, here.
 */
export function ParkingPlan({ depotId, order, operatingDate }: ParkingPlanProps) {
  const diagram = buildParkingDiagram(order);
  return (
    <section aria-labelledby="parking-plan-heading" data-testid="parking-plan" className="min-w-0">
      <SectionLabel
        id="parking-plan-heading"
        label="Night parking order"
        tag="modelled"
        note={planDateSentence(operatingDate)}
      />
      <p
        role={diagram.status.warning ? 'alert' : 'status'}
        data-testid="parking-blocked"
        className={`depot-prose mb-2 ${diagram.status.warning ? 'text-alert-amber' : 'text-alert-green'}`}
      >
        {diagram.status.text}
      </p>
      <figure className="m-0 min-w-0">
        {/* relative: the absolutely placed lanes stay inside this scrolling frame. */}
        <div
          role="img"
          aria-label={diagram.summary}
          className="relative min-w-0 overflow-x-auto"
          data-testid="parking-diagram"
        >
          <div className="relative" style={{ width: diagram.widthPx, height: diagram.heightPx }}>
            {diagram.lanes.map((lane) => (
              <LaneStrip key={lane.id} lane={lane} />
            ))}
          </div>
        </div>
        <figcaption className="depot-caption mt-2 max-w-[80ch]" data-testid="parking-note">
          Exit on the left; a dashed place is free; hover a place for the full registration.{' '}
          {PLAN_NOTICE}
        </figcaption>
      </figure>
      {diagram.overflow.length > 0 ? (
        <div className="mt-3" data-testid="parking-overflow">
          <p className="depot-prose text-depot-ink">{overflowSentence(diagram.overflow.length)}</p>
          <ul className="mt-1 space-y-0.5">
            {diagram.overflow.map((bus) => (
              <li key={bus.registration} className="min-w-0 break-words text-[13px]">
                <BusLink depotId={depotId} registration={bus.registration} />
                <span className="text-depot-muted">
                  {' '}
                  · first duty {bus.timeText} · {bus.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3">
        <CollapsedSection variant="row" label="The order as a list" testId="parking-list" keepMounted>
          <ul className="mt-2">
            {order.lanes.map((lane) => (
              <LaneList key={lane.id} depotId={depotId} lane={lane} />
            ))}
          </ul>
        </CollapsedSection>
      </div>
    </section>
  );
}
