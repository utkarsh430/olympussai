'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Bot, Building2, Bus, Route as RouteIcon } from 'lucide-react';
import { depotHref, incidentBusHref, rosterBusHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { BUS_STATE_LABEL, DEPOT_KIND_LABEL } from '@/lib/depot/labels';
import { routeHourlyPath } from '@/lib/depot/nav';
import { decisionHref } from '@/lib/depot/os/intel/decisions';
import { auditVehicle } from '@/lib/depot/os/intel/fuelAudit';
import { FAULT_LABEL, summariseHealth } from '@/lib/depot/os/intel/vehicleHealth';
import { regionById, regionOf } from '@/lib/depot/os/regions';
import { useIntel, type Intel } from './IntelProvider';
import { clockOf } from '@/lib/depot/os/intel/readiness';
import { DEFAULT_BUS_PARAMS } from '@/lib/depot/os/sched/config';
import { tripsFor } from '@/lib/depot/os/sched/trips';
import { optimiseBuses, restrictBuses, RESTRICTION_LABEL } from '@/lib/depot/os/sched/vehicles';
import { OsOverlay, OverlayClose } from './OsOverlay';
import { useSchedInput } from './sched/useSchedInput';
import { useOsStore, type EntityRef } from './osStore';
import { EmptyNote, Fact, MeterBar, SeverityChip, Sparkline, StatusTag } from './ui';

const RISK_TONE = { high: 'crimson', elevated: 'amber', normal: 'green' } as const;

function Section({ title, status, children }: { readonly title: string; readonly status?: Parameters<typeof StatusTag>[0]['status']; readonly children: React.ReactNode }) {
  return (
    <section className="border-b border-holo-glow/10 px-4 py-3 last:border-b-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="os-kicker">{title}</h3>
        {status ? <StatusTag status={status} /> : null}
      </div>
      {children}
    </section>
  );
}

function DecisionList({ intel, match }: { readonly intel: Intel; readonly match: (entityId: string, depotId: string | null) => boolean }) {
  const closeEntity = useOsStore((s) => s.closeEntity);
  const related = intel.decisions.filter((d) => match(d.entity.id, d.depotId)).slice(0, 5);
  if (related.length === 0) return <p className="depot-note">No open AI decision concerns this.</p>;
  return (
    <ul className="space-y-1.5">
      {related.map((d) => (
        <li key={d.id}>
          <Link href={decisionHref(d.id, d.depotId)} onClick={closeEntity} className="flex items-start gap-2 rounded-[4px] border border-holo-glow/10 px-2.5 py-2 hover:border-holo-glow/35">
            <SeverityChip severity={d.severity} />
            <span className="min-w-0 flex-1 font-sans text-[12.5px] leading-4 text-depot-ink">{d.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The bus's day in the AI Bus Scheduler's balanced plan for its depot: held (and why), or
 * the departures it runs. The same engine and inputs as the scheduler page, so the bus
 * reads the same here and there.
 */
function PlannedDay({ registration, depotId }: { readonly registration: string; readonly depotId: string }) {
  const closeEntity = useOsStore((s) => s.closeEntity);
  const input = useSchedInput(depotId, null);
  const day = useMemo(() => {
    if (!input.timetable) return null;
    const buses = restrictBuses(input.buses, DEFAULT_BUS_PARAMS);
    const me = buses.find((b) => b.registration === registration) ?? null;
    const plan = optimiseBuses(input.timetable, tripsFor(input.timetable, DEFAULT_BUS_PARAMS), buses, DEFAULT_BUS_PARAMS);
    return { me, block: plan.blocks.find((b) => b.registration === registration) ?? null };
  }, [input.timetable, input.buses, registration]);
  if (!day) return <p className="depot-note">Planning the depot&apos;s day.</p>;
  return (
    <>
      {day.me?.restriction ? (
        <p className="font-sans text-[12.5px] text-alert-amber">Held out of today&apos;s plan: {RESTRICTION_LABEL[day.me.restriction].toLowerCase()}.</p>
      ) : day.block ? (
        <>
          <p className="font-sans text-[12.5px] text-depot-ink">
            Runs {formatCount(day.block.trips.length)} departures, {clockOf(day.block.start % 1440)}–{clockOf(day.block.end % 1440)}, carrying about {formatCount(day.block.passengers)} passengers.
          </p>
          <ul className="mt-1 space-y-0.5">
            {day.block.trips.slice(0, 6).map((t) => (
              <li key={t.id} className="flex justify-between font-mono text-[11.5px] text-depot-prose">
                <span>{t.routeId}</span>
                <span>
                  {clockOf(t.dep % 1440)}–{clockOf(t.arr % 1440)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="depot-note">Not needed in today&apos;s plan: a spare the depot can call on.</p>
      )}
      <Link href={`${depotHref(depotId)}/bus-scheduler`} onClick={closeEntity} className="depot-link mt-1.5 inline-block font-sans text-[12px]">
        Open the AI Bus Scheduler
      </Link>
    </>
  );
}

function VehicleProfile({ id, depotId, intel }: { readonly id: string; readonly depotId: string | null; readonly intel: Intel }) {
  const closeEntity = useOsStore((s) => s.closeEntity);
  const askCopilot = useOsStore((s) => s.askCopilot);
  const bus = intel.fleet?.find((b) => b.registration === id) ?? null;
  const home = bus?.depotId ?? depotId;
  const health = intel.healthByReg.get(id) ?? null;
  const fuel = useMemo(
    () => (bus && intel.operatingDate ? auditVehicle(bus, intel.operatingDate) : null),
    [bus, intel.operatingDate],
  );
  const incident = intel.incidents?.rows.find((r) => r.registrationNumber === id) ?? null;
  const depotName = home ? (intel.depotsById.get(home)?.name ?? home) : 'No home depot';

  if (!bus) {
    return <EmptyNote>{intel.fleet ? `${id} is not in the latest snapshot.` : 'Loading the fleet index.'}</EmptyNote>;
  }
  const flagged = fuel?.journeys.filter((j) => j.flagged) ?? [];
  return (
    <>
      <Section title="Current known status" status="live">
        <dl>
          <Fact label="State" value={BUS_STATE_LABEL[bus.state]} />
          <Fact label="Home depot" value={depotName} />
          <Fact label="Route in feed" value={bus.routeName ?? 'None carried'} />
          <Fact label="Last GPS fix" value={bus.gpsAgeMin === null ? 'Unknown' : `${formatCount(bus.gpsAgeMin)} min ago`} />
          <Fact
            label="Latest position"
            value={bus.lat !== null && bus.lng !== null ? `${bus.lat.toFixed(4)}, ${bus.lng.toFixed(4)}` : 'Not positioned'}
          />
        </dl>
      </Section>
      {home ? (
        <Section title="Today's plan" status="proposed">
          <PlannedDay registration={id} depotId={home} />
        </Section>
      ) : null}
      {health ? (
        <Section title="Maintenance and breakdown risk" status="estimate">
          <div className="mb-2 flex items-center gap-3">
            <span className="os-value text-[20px]">{health.risk}</span>
            <div className="flex-1">
              <MeterBar value={health.risk} max={100} tone={RISK_TONE[health.band]} />
              <div className="mt-1 font-sans text-[11.5px] text-depot-prose">Risk index · {health.band}</div>
            </div>
          </div>
          <dl>
            <Fact label="Odometer" value={`${formatCount(health.service.odometerKm)} km`} />
            <Fact
              label="Next service"
              value={health.service.kmToNextService < 0 ? `${formatCount(-health.service.kmToNextService)} km overdue` : `in ${formatCount(health.service.kmToNextService)} km (~${health.serviceDueInDays} days)`}
              tone={health.service.group === 'overdue' ? 'crimson' : health.service.group === 'due_soon' ? 'amber' : undefined}
            />
            <Fact label="Recurring fault" value={health.recurring ? FAULT_LABEL[health.recurring] : 'None'} tone={health.recurring ? 'amber' : undefined} />
          </dl>
          {health.factors.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {health.factors.map((f) => (
                <li key={f.label} className="flex justify-between gap-3 font-sans text-[12px] text-depot-prose">
                  <span>{f.label}</span>
                  <span className="font-mono text-depot-ink">+{f.points}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}
      {fuel ? (
        <Section title="Fuel efficiency, last 14 days" status="scenario">
          <div className="flex items-center justify-between gap-3">
            <dl className="flex-1">
              <Fact label="Median economy" value={fuel.medianKmPerLitre === null ? '—' : `${fuel.medianKmPerLitre.toFixed(2)} km/L`} />
              <Fact label="Class figure" value={`${fuel.classKmPerLitre.toFixed(1)} km/L`} />
              <Fact label="Flagged journeys" value={formatCount(flagged.length)} tone={flagged.length > 0 ? 'amber' : undefined} />
            </dl>
            <Sparkline values={fuel.journeys.map((j) => j.kmPerLitre)} tone="teal" width={110} height={36} />
          </div>
        </Section>
      ) : null}
      <Section title="Incidents" status="derived">
        {incident ? (
          <Link href={incidentBusHref(incident.depotId, id)} onClick={closeEntity} className="depot-link font-sans text-[12.5px]">
            Suspected breakdown ({incident.confidence} confidence): open Incident Response
          </Link>
        ) : (
          <p className="depot-note">No suspected breakdown on the latest snapshot.</p>
        )}
      </Section>
      <Section title="AI recommendations">
        <DecisionList intel={intel} match={(entityId, decisionDepot) => entityId === id || (decisionDepot === home && entityId === home && (health?.band === 'high' || flagged.length > 0))} />
      </Section>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {home ? (
          <>
            <Link href={rosterBusHref(home, id)} onClick={closeEntity} className="os-button">Roster and timetable</Link>
            <Link href={`${depotHref(home)}/disruption?bus=${encodeURIComponent(id)}`} onClick={closeEntity} className="os-button os-button-quiet">Disruption if unavailable</Link>
            <Link href={`${depotHref(home)}/fuel-audit?bus=${encodeURIComponent(id)}`} onClick={closeEntity} className="os-button os-button-quiet">Fuel history</Link>
          </>
        ) : null}
        <button type="button" onClick={() => askCopilot(`Tell me about bus ${id}`)} className="os-button os-button-quiet">
          <Bot className="h-3.5 w-3.5" aria-hidden />
          Ask the copilot
        </button>
      </div>
    </>
  );
}

function DepotProfile({ id, intel }: { readonly id: string; readonly intel: Intel }) {
  const closeEntity = useOsStore((s) => s.closeEntity);
  const askCopilot = useOsStore((s) => s.askCopilot);
  const depot = intel.depotsById.get(id) ?? null;
  const score = intel.network?.scores.find((s) => s.depotId === id) ?? null;
  const balance = intel.distribution?.balances.find((b) => b.depotId === id) ?? null;
  const health = useMemo(() => (intel.health ? summariseHealth(intel.health.filter((h) => h.depotId === id)) : null), [intel.health, id]);
  const fuel = useMemo(() => {
    if (!intel.fuel) return null;
    const flagged = intel.fuel.flagged.filter((j) => j.depotId === id);
    return { journeys: flagged.length, litres: flagged.reduce((s, j) => s + j.excessLitres, 0), rupees: flagged.reduce((s, j) => s + j.exposureRupees, 0) };
  }, [intel.fuel, id]);
  if (!depot) return <EmptyNote>{intel.network ? 'This depot is not in the latest snapshot.' : 'Loading the depots.'}</EmptyNote>;
  const region = regionById(regionOf(depot));
  return (
    <>
      <Section title="Fleet" status="live">
        <dl>
          <Fact label="Kind · region" value={`${DEPOT_KIND_LABEL[depot.kind]} · ${region?.name ?? 'Unplaced'}`} />
          <Fact label="Fleet" value={formatCount(depot.fleet)} />
          <Fact label="In service / on road" value={formatCount(depot.states.inService + depot.states.onRoad)} tone="green" />
          <Fact label="Standing" value={formatCount(depot.states.standing)} tone="amber" />
          <Fact label="Dark" value={formatCount(depot.states.dark)} />
          <Fact label="Off road" value={formatCount(depot.states.offRoad)} tone="crimson" />
        </dl>
      </Section>
      {balance ? (
        <Section title="Service requirement" status="estimate">
          <dl>
            <Fact label="Available" value={formatCount(balance.available)} />
            <Fact label="Peak need + spare" value={`${formatCount(balance.peakRequirement)} + ${formatCount(balance.spareTarget)}`} />
            <Fact label="Balance" value={balance.balance >= 0 ? `+${formatCount(balance.balance)} surplus` : `${formatCount(balance.balance)} short`} tone={balance.balance < 0 ? 'crimson' : 'green'} />
          </dl>
        </Section>
      ) : null}
      {score && score.index !== null ? (
        <Section title="Efficiency index" status="derived">
          <div className="flex items-center gap-3">
            <span className="os-value">{score.index.toFixed(1)}</span>
            <span className="font-sans text-[12px] text-depot-prose">Rank {score.rank} of {score.peerCount} in its peer group</span>
          </div>
        </Section>
      ) : null}
      {health ? (
        <Section title="Maintenance workload" status="estimate">
          <dl>
            <Fact label="Service overdue" value={formatCount(health.overdue)} tone={health.overdue > 0 ? 'amber' : undefined} />
            <Fact label="Due within 1,500 km" value={formatCount(health.dueSoon)} />
            <Fact label="High breakdown risk" value={formatCount(health.highRisk)} tone={health.highRisk > 0 ? 'crimson' : undefined} />
          </dl>
        </Section>
      ) : null}
      {fuel ? (
        <Section title="Fuel audit, 14 days" status="scenario">
          <dl>
            <Fact label="Flagged journeys" value={formatCount(fuel.journeys)} />
            <Fact label="Excess fuel · exposure" value={`${formatCount(Math.round(fuel.litres))} L · ₹${formatCount(fuel.rupees)}`} />
          </dl>
        </Section>
      ) : null}
      <Section title="Critical issues and AI recommendations">
        <DecisionList intel={intel} match={(_, decisionDepot) => decisionDepot === id} />
      </Section>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Link href={depotHref(id)} onClick={closeEntity} className="os-button">Open depot Mission Control</Link>
        <Link href={`${depotHref(id)}/readiness`} onClick={closeEntity} className="os-button os-button-quiet">Dispatch readiness</Link>
        <button type="button" onClick={() => askCopilot(`What needs attention at ${depot.name}?`)} className="os-button os-button-quiet">
          <Bot className="h-3.5 w-3.5" aria-hidden />
          Ask the copilot
        </button>
      </div>
    </>
  );
}

function RouteProfile({ id, intel }: { readonly id: string; readonly intel: Intel }) {
  const closeEntity = useOsStore((s) => s.closeEntity);
  const openEntity = useOsStore((s) => s.openEntity);
  const buses = useMemo(() => (intel.fleet ?? []).filter((b) => b.routeName === id), [intel.fleet, id]);
  const depots = [...new Set(buses.map((b) => b.depotId).filter((d): d is string => d !== null))];
  const moving = buses.filter((b) => b.state === 'in_service' || b.state === 'on_road').length;
  return (
    <>
      <Section title="Vehicles on the route" status="live">
        <dl>
          <Fact label="Buses carrying the route" value={formatCount(buses.length)} />
          <Fact label="Moving now" value={formatCount(moving)} tone="green" />
          <Fact label="Depots running it" value={depots.map((d) => intel.depotsById.get(d)?.name ?? d).join(', ') || '—'} />
        </dl>
        {buses.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {buses.slice(0, 24).map((b) => (
              <li key={b.registration}>
                <button
                  type="button"
                  onClick={() => openEntity({ kind: 'vehicle', id: b.registration, depotId: b.depotId })}
                  className="rounded-[3px] border border-holo-glow/15 px-1.5 py-0.5 font-mono text-[11px] text-depot-ink hover:border-holo-glow/50"
                >
                  {b.registration}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section title="Coverage and redistribution">
        <p className="depot-note">
          The route&apos;s hour-by-hour demand, scheduled service and redistribution proposals are on its route page.
        </p>
      </Section>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Link href={routeHourlyPath(id)} onClick={closeEntity} className="os-button">Hourly demand and service</Link>
      </div>
    </>
  );
}

const ICONS = { vehicle: Bus, depot: Building2, route: RouteIcon } as const;
const KINDS = { vehicle: 'Vehicle intelligence profile', depot: 'Depot intelligence profile', route: 'Route intelligence profile' } as const;

function titleOf(entity: EntityRef, intel: Intel): string {
  if (entity.kind === 'depot') return intel.depotsById.get(entity.id)?.name ?? entity.id;
  return entity.id;
}

/** The one profile drawer every workspace opens for a vehicle, a depot or a route. */
export function EntityDrawer() {
  const entity = useOsStore((s) => s.entity);
  const closeEntity = useOsStore((s) => s.closeEntity);
  const intel = useIntel();
  if (!entity) return null;
  const Icon = ICONS[entity.kind];
  return (
    <OsOverlay open onClose={closeEntity} label={`${KINDS[entity.kind]}: ${titleOf(entity, intel)}`} variant="drawer" testId="os-entity-drawer">
      <header className="os-panel-head">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className="h-5 w-5 shrink-0 text-holo-glow" aria-hidden />
          <div className="min-w-0">
            <div className="os-kicker">{KINDS[entity.kind]}</div>
            <h2 className="truncate font-mono text-[16px] font-semibold text-depot-ink">{titleOf(entity, intel)}</h2>
          </div>
        </div>
        <OverlayClose onClose={closeEntity} />
      </header>
      <div className="os-scroll min-h-0 flex-1 overflow-y-auto">
        {entity.kind === 'vehicle' ? <VehicleProfile id={entity.id} depotId={entity.depotId} intel={intel} /> : null}
        {entity.kind === 'depot' ? <DepotProfile id={entity.id} intel={intel} /> : null}
        {entity.kind === 'route' ? <RouteProfile id={entity.id} intel={intel} /> : null}
      </div>
    </OsOverlay>
  );
}
