'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight, Bot } from 'lucide-react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotCrew } from '@/hooks/useDepotCrew';
import { useDepotDuties } from '@/hooks/useDepotDuties';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount, formatFeedTime } from '@/lib/depot/format';
import { buildReadiness, clockOf, feedMinuteOf } from '@/lib/depot/os/intel/readiness';
import { summariseHealth } from '@/lib/depot/os/intel/vehicleHealth';
import { regionById, regionOf } from '@/lib/depot/os/regions';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { DecisionPanel } from '../decisions/DecisionPanel';
import { DecisionQueue } from '../decisions/DecisionQueue';
import { SituationMap, type MapIncident, type MapVehicle } from '../map/SituationMap';
import { CheckDot, ReadinessChip, READINESS_BAR } from '../readiness/ReadinessChip';
import { StateMixBar } from '../StateMixBar';
import { EmptyNote, Fact, MeterBar, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';

const UPCOMING = 10;
const WINDOW_MIN = 120;

function vehicleState(state: string): MapVehicle['state'] {
  if (state === 'in_service' || state === 'on_road') return 'moving';
  if (state === 'off_road') return 'off_road';
  if (state === 'dark') return 'dark';
  return 'standing';
}

/**
 * One depot's Mission Control: its fleet readiness, the next departures and what stands
 * in their way, buses and crew against the day's need, maintenance constraints, the
 * depot's own AI queue and the selected decision.
 */
export function DepotMissionControl() {
  const { depotId, data: detail, error } = useDepotDetailContext();
  const duties = useDepotDuties(depotId);
  const crew = useDepotCrew(depotId);
  const intel = useIntel();
  const openEntity = useOsStore((s) => s.openEntity);
  const askCopilot = useOsStore((s) => s.askCopilot);
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);

  const depot = detail?.depot ?? intel.depotsById.get(depotId) ?? null;
  const region = depot ? regionById(regionOf(depot)) : null;
  const balance = intel.distribution?.balances.find((b) => b.depotId === depotId) ?? null;
  const buses = useMemo(() => detail?.buses ?? [], [detail]);
  const health = useMemo(() => (intel.health ?? []).filter((h) => h.depotId === depotId), [intel.health, depotId]);
  const healthSummary = useMemo(() => summariseHealth(health), [health]);
  const nowMin = feedMinuteOf(detail?.feedNow ?? null);
  const board = useMemo(
    () => (duties.data ? buildReadiness(duties.data, crew.data ?? null, buses, intel.healthByReg, nowMin) : null),
    [duties.data, crew.data, buses, intel.healthByReg, nowMin],
  );
  const upcoming = useMemo(
    () =>
      (board?.departures ?? [])
        .filter((d) => d.readiness !== 'completed' && d.readiness !== 'departed' && (d.startsInMin === null || d.startsInMin >= -30))
        .slice(0, UPCOMING),
    [board],
  );
  const nextWindow = (board?.departures ?? []).filter((d) => d.startsInMin !== null && d.startsInMin >= 0 && d.startsInMin <= WINDOW_MIN);
  const windowAtRisk = nextWindow.filter((d) => d.readiness === 'blocked' || d.readiness === 'at_risk').length;
  const readyNow = buses.filter((b) => b.state === 'standing' && b.location === 'in_yard').length;

  const vehicles = useMemo<MapVehicle[]>(
    () =>
      buses.flatMap((b) =>
        b.latitude !== null && b.longitude !== null ? [{ id: b.registrationNumber, position: { lat: b.latitude, lng: b.longitude }, state: vehicleState(b.state) }] : [],
      ),
    [buses],
  );
  const incidents = useMemo<MapIncident[]>(
    () =>
      (intel.incidents?.rows ?? [])
        .filter((r) => r.depotId === depotId)
        .flatMap((r) => {
          const bus = buses.find((b) => b.registrationNumber === r.registrationNumber);
          return bus && bus.latitude !== null && bus.longitude !== null
            ? [{ id: r.registrationNumber, position: { lat: bus.latitude, lng: bus.longitude }, label: `${r.registrationNumber}: possible breakdown` }]
            : [];
        }),
    [intel.incidents, depotId, buses],
  );
  const yard = detail?.yard.value ?? null;
  const centre = yard ? { lat: yard.lat, lng: yard.lng } : (depot?.centroid ?? null);

  const decision = intel.decisions.find((d) => d.id === selectedDecision) ?? intel.decisions[0] ?? null;
  const name = depot?.name ?? `Depot ${depotId}`;
  const root = depotHref(depotId);

  if (error && !detail) {
    return (
      <>
        <OsHeader title="Mission Control" description="This depot's command view." />
        <div className="os-panel">
          <EmptyNote>{error}</EmptyNote>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4" data-testid="os-depot-mission-control">
      <OsHeader
        eyebrow={region ? `${region.name} region · ${name}` : name}
        title={`${name} Mission Control`}
        description="Fleet readiness, the next departures, resources against need and the depot's AI decisions."
        statuses={['live', 'estimate', 'scenario']}
        actions={
          <>
            <span className="font-mono text-[11px] text-depot-muted">Feed clock {formatFeedTime(detail?.feedNow ?? null)}</span>
            <button type="button" onClick={() => askCopilot(`What needs attention at ${name}?`)} className="os-button os-button-quiet">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              Brief me
            </button>
            <Link href={`${root}/readiness`} className="os-button">
              Dispatch readiness
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </>
        }
      />

      {!depot ? (
        <PanelLoading rows={2} label="Loading the depot" />
      ) : (
        <MetricStrip columns={8}>
          <Metric label="Fleet" value={formatCount(depot.fleet)} sub={`${formatCount(depot.reporting)} reporting`} status="live" href={`${root}/roster`} />
          <Metric label="Ready in yard" value={formatCount(readyNow)} sub="Standing inside the yard" tone="green" href={`${root}/yard`} />
          <Metric label="On road" value={formatCount(depot.states.inService + depot.states.onRoad)} sub="In service or moving" tone="cyan" href={`${root}/roster`} />
          <Metric label="Off road" value={formatCount(depot.states.offRoad)} tone="crimson" sub="Flagged maintenance" href={`${root}/maintenance`} />
          <Metric label="Dark" value={formatCount(depot.states.dark)} sub="No GPS signal" href={`${root}/roster`} />
          <Metric
            label="Peak need"
            value={balance ? `${formatCount(balance.required)}` : '—'}
            sub={balance ? (balance.balance < 0 ? `${formatCount(-balance.balance)} short of ${formatCount(balance.available)} available` : `${formatCount(balance.balance)} above need`) : 'Loading'}
            tone={balance && balance.balance < 0 ? 'crimson' : null}
            status="estimate"
          />
          <Metric
            label="Next 2 h departures"
            value={board ? formatCount(nextWindow.length) : '—'}
            sub={board ? `${formatCount(windowAtRisk)} at risk or blocked` : 'Loading the duty plan'}
            tone={windowAtRisk > 0 ? 'amber' : null}
            href={`${root}/readiness`}
          />
          <Metric
            label="Crew shifts covered"
            value={crew.data ? `${formatCount(crew.data.summary.shiftsCovered)}/${formatCount(crew.data.summary.shiftsRequired)}` : '—'}
            sub={crew.data ? `${formatCount(crew.data.summary.shiftsUncovered)} uncovered` : 'Loading'}
            tone={crew.data && crew.data.summary.shiftsUncovered > 0 ? 'amber' : null}
            status="scenario"
            href={`${root}/crew`}
          />
        </MetricStrip>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel kicker="Situation" title={`${name} · buses and yard`} actions={<StatusTag status="live" />} bodyClassName="p-0" strong>
          <SituationMap
            depots={depot ? [{ id: depot.id, name, position: centre, fleet: depot.fleet, balance: balance?.balance ?? null, decisions: intel.decisions.length }] : []}
            transfers={[]}
            incidents={incidents}
            vehicles={vehicles}
            selectedId={null}
            onSelect={(id) => (id ? openEntity({ kind: 'depot', id }) : undefined)}
            availableLayers={['pressure', 'vehicles', 'incidents']}
            defaultLayers={['pressure', 'vehicles', 'incidents']}
            heightClass="h-[482px] rounded-none border-0"
          />
        </Panel>
        <Panel kicker="Depot AI queue" title={`${formatCount(intel.decisions.length)} decisions`} className="h-[540px]" bodyClassName="flex min-h-0 flex-col">
          <DecisionQueue decisions={intel.decisions} selectedId={decision?.id ?? null} onSelect={setSelectedDecision} loading={!intel.ready} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          kicker="Dispatch readiness"
          title="Next departures"
          actions={
            <Link href={`${root}/readiness`} className="depot-link font-sans text-[12px]">
              Full board
            </Link>
          }
          bodyClassName="p-0"
        >
          {!board ? (
            <PanelLoading rows={5} label="Loading the duty plan" />
          ) : (
            <>
              <div className="flex h-2 w-full overflow-hidden" aria-hidden>
                {(['ready', 'at_risk', 'blocked', 'unverified', 'departed', 'completed'] as const).map((k) =>
                  board.counts[k] > 0 ? (
                    <span key={k} className={READINESS_BAR[k]} style={{ width: `${(board.counts[k] / board.departures.length) * 100}%` }} />
                  ) : null,
                )}
              </div>
              {upcoming.length === 0 ? (
                <EmptyNote>No departure left in today&apos;s plan.</EmptyNote>
              ) : (
                <table className="os-table">
                  <thead>
                    <tr>
                      <th>Due</th>
                      <th>Duty</th>
                      <th>Route</th>
                      <th>Bus</th>
                      <th>Checks</th>
                      <th>Readiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map((d) => (
                      <tr key={d.dutyId} className="os-row">
                        <td className="font-mono">{clockOf(d.startMin)}</td>
                        <td className="font-mono text-depot-prose">{d.dutyId}</td>
                        <td className="max-w-[12rem] truncate font-mono">{d.routeName}</td>
                        <td>
                          {d.registration ? (
                            <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: d.registration!, depotId })} className="font-mono text-holo-glow hover:underline">
                              {d.registration}
                            </button>
                          ) : (
                            <span className="text-alert-crimson">No bus</span>
                          )}
                        </td>
                        <td>
                          <span className="flex items-center gap-1">
                            {d.checks.map((c) => (
                              <CheckDot key={c.key} state={c.state} title={`${c.label}: ${c.detail}`} />
                            ))}
                          </span>
                        </td>
                        <td>
                          <ReadinessChip readiness={d.readiness} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Panel>

        <Panel kicker="Resources" title="Availability against need" bodyClassName="space-y-4 p-4">
          {depot ? (
            <div>
              <div className="os-kicker mb-1.5">Buses by state</div>
              <StateMixBar states={depot.states} fleet={depot.fleet} legend />
            </div>
          ) : null}
          {crew.data ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="os-kicker">Crew today</span>
                <StatusTag status="scenario" />
              </div>
              {(['driver', 'conductor'] as const).map((role) => {
                const f = crew.data!.summary[role];
                return (
                  <div key={role} className="mb-2">
                    <div className="mb-1 flex justify-between font-sans text-[12px] text-depot-prose">
                      <span className="capitalize">{role}s available / required</span>
                      <span className={`font-mono ${f.available < f.required ? 'text-alert-amber' : 'text-depot-ink'}`}>
                        {formatCount(f.available)} / {formatCount(f.required)}
                      </span>
                    </div>
                    <MeterBar value={f.available} max={Math.max(f.available, f.required)} marker={f.required} tone={f.available < f.required ? 'amber' : 'green'} />
                  </div>
                );
              })}
            </div>
          ) : null}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="os-kicker">Maintenance constraints</span>
              <StatusTag status="estimate" />
            </div>
            <dl>
              <Fact label="Off road now" value={formatCount(healthSummary.offRoad)} tone={healthSummary.offRoad > 0 ? 'crimson' : undefined} />
              <Fact label="Service overdue" value={formatCount(healthSummary.overdue)} tone={healthSummary.overdue > 0 ? 'amber' : undefined} />
              <Fact label="High breakdown risk on the road" value={formatCount(healthSummary.highRiskOnRoad)} tone={healthSummary.highRiskOnRoad > 0 ? 'crimson' : undefined} />
              <Fact label="Fit standby buses" value={formatCount(healthSummary.standbyCandidates)} tone="green" />
            </dl>
          </div>
        </Panel>
      </div>

      <Panel kicker="AI decision" title="Selected decision" strong bodyClassName="p-0">
        <DecisionPanel decision={decision} />
      </Panel>
    </div>
  );
}
