'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import type { VehicleHealth } from '@/lib/depot/os/intel/vehicleHealth';
import { DEFAULT_BUS_PARAMS } from '@/lib/depot/os/sched/config';
import { tripsFor } from '@/lib/depot/os/sched/trips';
import { optimiseBuses, restrictBuses } from '@/lib/depot/os/sched/vehicles';
import { AiKindChip } from '../aiKinds';
import { useSchedInput } from '../sched/useSchedInput';
import { EmptyNote, Fact, Panel, PanelLoading, StatusTag } from '../ui';

const HORIZON_DAYS = 14;

/** Buses coming due for service on each of the next fourteen days, and the overdue backlog. */
export function ServiceDueProjection({ health }: { readonly health: readonly VehicleHealth[] }) {
  const { overdue, days } = useMemo(() => {
    const counts = Array.from({ length: HORIZON_DAYS }, () => 0);
    let late = 0;
    for (const h of health) {
      if (h.serviceDueInDays < 0) late += 1;
      else if (h.serviceDueInDays < HORIZON_DAYS) counts[Math.floor(h.serviceDueInDays)]! += 1;
    }
    return { overdue: late, days: counts };
  }, [health]);
  const max = Math.max(1, overdue, ...days);
  return (
    <Panel kicker="Service due projection" title={`Buses coming due over the next ${HORIZON_DAYS} days`} actions={<StatusTag status="forecast" />} bodyClassName="space-y-2 p-4">
      <div className="flex h-32 items-end gap-1" role="img" aria-label="Buses past service due, and coming due each day">
        {[overdue, ...days].map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="font-mono text-[10px] text-depot-prose">{n > 0 ? formatCount(n) : ''}</span>
            <div
              className={`w-full rounded-t-[2px] ${i === 0 ? 'bg-alert-crimson' : i <= 3 ? 'bg-alert-amber' : 'bg-holo-deep'}`}
              style={{ height: `${(n / max) * 96}px` }}
              title={i === 0 ? `${n} past due` : `Day ${i}: ${n} buses`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-depot-muted">
        <span>Overdue</span>
        <span>Days ahead, at each class&apos;s daily distance</span>
        <span>+{HORIZON_DAYS}</span>
      </div>
    </Panel>
  );
}

/**
 * What maintenance means for today's service at one depot: the day planned with every
 * bus allowed, and again with buses past service and at high risk held back, through the
 * AI Bus Scheduler's engine. The difference is the service those buses carry.
 */
export function MaintenanceImpact({ depotId }: { readonly depotId: string }) {
  const input = useSchedInput(depotId, null);
  const result = useMemo(() => {
    if (!input.timetable) return null;
    const open = { ...DEFAULT_BUS_PARAMS, holdOverdue: false, holdHighRisk: false };
    const held = { ...DEFAULT_BUS_PARAMS, holdOverdue: true, holdHighRisk: true };
    const trips = tripsFor(input.timetable, open);
    const openBuses = restrictBuses(input.buses, open);
    const allowed = optimiseBuses(input.timetable, trips, openBuses, open);
    const heldPlan = optimiseBuses(input.timetable, trips, restrictBuses(input.buses, held), held);
    const atRisk = new Set(input.buses.filter((b) => b.serviceDueInDays < 0 || b.risk >= 50).map((b) => b.registration));
    const dependent = allowed.blocks.filter((b) => atRisk.has(b.registration));
    return {
      atRisk: atRisk.size,
      dependentBuses: dependent.length,
      dependentDepartures: dependent.reduce((s, b) => s + b.trips.length, 0),
      dependentPassengers: dependent.reduce((s, b) => s + b.passengers, 0),
      allowed: allowed.metrics,
      held: heldPlan.metrics,
    };
  }, [input.timetable, input.buses]);
  return (
    <Panel kicker="Impact on scheduled departures" title="What maintenance holds cost today's service" actions={<AiKindChip kind="predict" />} bodyClassName="space-y-3 p-4">
      {!result ? (
        input.depot ? <PanelLoading rows={3} label="Planning the day both ways" /> : <EmptyNote>Open a depot to see the effect on its departures.</EmptyNote>
      ) : (
        <>
          <p className="font-sans text-[12.5px] leading-5 text-depot-ink">
            {formatCount(result.dependentDepartures)} departures ({formatCount(result.dependentPassengers)} passengers) would ride on {formatCount(result.dependentBuses)} of the{' '}
            {formatCount(result.atRisk)} buses past service or at high risk if every bus were allowed out.
          </p>
          <dl>
            <Fact label="Departures covered, every bus allowed" value={`${formatCount(result.allowed.covered)} of ${formatCount(result.allowed.departures)}`} />
            <Fact label="Departures covered, at-risk buses held" value={`${formatCount(result.held.covered)} of ${formatCount(result.held.departures)}`} tone={result.held.covered < result.allowed.covered ? 'amber' : 'green'} />
            <Fact label="Buses used · held" value={`${formatCount(result.held.busesUsed)} · ${formatCount(result.atRisk)}`} />
          </dl>
          <p className="depot-note">
            {result.held.covered >= result.allowed.covered
              ? 'Holding them costs no departure: the rest of the fleet absorbs their work, so they can go to the workshop today.'
              : `Holding them leaves ${formatCount(result.allowed.covered - result.held.covered)} departures uncovered: book the overdue ones first and the high-risk ones into the quietest bays.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`${depotHref(depotId)}/bus-scheduler`} className="os-button">
              Plan around them
            </Link>
            <Link href={`${depotHref(depotId)}/health?section=bay-plan`} className="os-button os-button-quiet">
              Repair bay plan
            </Link>
          </div>
        </>
      )}
    </Panel>
  );
}
