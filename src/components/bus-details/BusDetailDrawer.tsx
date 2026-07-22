'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import {
  X,
  GitMerge,
  TrafficCone,
  Wrench,
  Users,
  PhoneCall,
  MapPin,
  Clock,
  Route as RouteIcon,
} from 'lucide-react';
import { useCopilotStore, useSelectedBus } from '@/stores/copilotStore';
import { Badge, Readout } from '@/components/shared/hud';
import { LIVE_LABELS } from '@/lib/constants';
import {
  formatCoordinate,
  formatHeading,
  formatRelativeAge,
  formatScheduleTime,
  formatSpeed,
  formatIndiaDateTime,
  DATA_QUALITY_META,
} from '@/lib/formatters';
import { buildScenario } from '@/lib/simulation/scenarioEngine';
import type { ScenarioKind } from '@/lib/demo-scenarios/types';

const ANALYSIS_ACTIONS: Array<{
  kind: Exclude<ScenarioKind, 'communication'> | 'contact';
  label: string;
  detail: string;
  icon: typeof GitMerge;
  testId: string;
}> = [
  { kind: 'bunching', label: 'Bunching Analysis', detail: 'Bus spacing on this corridor', icon: GitMerge, testId: 'analysis-bunching' },
  { kind: 'traffic', label: 'Traffic Analysis', detail: 'Congestion and route options ahead', icon: TrafficCone, testId: 'analysis-traffic' },
  { kind: 'breakdown', label: 'Incident Response', detail: 'Assistance coordination options', icon: Wrench, testId: 'analysis-breakdown' },
  { kind: 'demand', label: 'Demand - Supply Analysis', detail: 'Loading and fleet distribution', icon: Users, testId: 'analysis-demand' },
  { kind: 'contact', label: 'Contact Driver', detail: 'Prepare a control-room instruction', icon: PhoneCall, testId: 'analysis-contact' },
];

export function BusDetailDrawer() {
  const bus = useSelectedBus();
  const schedule = useCopilotStore((state) => state.schedule);
  const scheduleMessage = useCopilotStore((state) => state.scheduleMessage);
  const isLoadingSchedule = useCopilotStore((state) => state.isLoadingSchedule);
  const scheduleSource = useCopilotStore((state) => state.feedMeta.scheduleSource);
  const selectBus = useCopilotStore((state) => state.selectBus);
  const setScenario = useCopilotStore((state) => state.setScenario);
  const setMessageModalOpen = useCopilotStore((state) => state.setMessageModalOpen);
  const setAi = useCopilotStore((state) => state.setAi);
  const overrides = useCopilotStore((state) => state.overrides);
  const logAudit = useCopilotStore((state) => state.logAudit);

  // Escape closes the drawer.
  useEffect(() => {
    if (!bus) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selectBus(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bus, selectBus]);

  function openAnalysis(kind: Exclude<ScenarioKind, 'communication'> | 'contact') {
    if (!bus) return;

    if (kind === 'contact') {
      setMessageModalOpen(true);
      setAi('Awaiting Authorization', 'Communication channel prepared.');
      logAudit('scenario-launched', `Driver communication opened for ${bus.registrationNumber}`, {
        registrationNumber: bus.registrationNumber,
      });
      return;
    }

    const scenario = buildScenario(kind, { bus, schedule, overrides });
    setScenario(kind, scenario);
    setAi('Analysing', 'Intervention analysis prepared for review.');

    logAudit('scenario-launched', `${scenario.simulationLabel} opened for ${bus.registrationNumber}`, {
      registrationNumber: bus.registrationNumber,
    });
    logAudit('alert-displayed', scenario.headline, {
      registrationNumber: bus.registrationNumber,
    });
  }

  const quality = bus ? DATA_QUALITY_META[bus.dataQuality] : null;

  return (
    // mode="wait" so switching buses quickly retires the outgoing drawer before
    // the next mounts — otherwise two drawers stack in the same slot.
    <AnimatePresence mode="wait">
      {bus && (
        <motion.aside
          key={bus.id}
          initial={{ x: -420, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -420, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="hud-panel-strong hud-corners absolute left-3 top-3 z-40 flex max-h-[calc(100%-24px)] w-[360px] flex-col overflow-hidden"
          role="region"
          aria-label={`Live detail for bus ${bus.registrationNumber}`}
          data-testid="bus-detail-drawer"
        >
          <header className="flex shrink-0 items-start justify-between gap-2 border-b border-holo-glow/20 px-4 py-3">
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-2">
                <Badge variant="live" pulse>
                  {LIVE_LABELS.liveData}
                </Badge>
                {scheduleSource === 'fixture' && (
                  <Badge variant="fixture">{LIVE_LABELS.fixture}</Badge>
                )}
              </div>
              <h2 className="font-mono text-lg font-bold tracking-[0.12em] text-holo-glow text-glow">
                {bus.registrationNumber}
              </h2>
              <p className="truncate font-mono text-[10px] text-holo-glow/45">
                {bus.routeName ?? 'No route assigned'} · {bus.depotName ?? 'Unknown depot'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => selectBus(null)}
              className="hud-button shrink-0 px-2 py-1"
              aria-label="Close bus details"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* ---- LIVE UPSRTC DATA ---- */}
            <section className="border-b border-holo-glow/12 px-4 py-3">
              <div className="mb-2.5 flex items-center gap-2">
                <MapPin className="h-3 w-3 text-alert-green" aria-hidden />
                <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-alert-green">
                  Live UPSRTC GPS
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                <Readout label="Coordinates" value={formatCoordinate(bus.latitude, bus.longitude)} />
                <Readout label="Speed" value={formatSpeed(bus.speedKmph)} />
                <Readout label="Heading" value={formatHeading(bus.headingDegrees)} />
                <Readout
                  label="Ignition"
                  value={bus.ignitionOn === null ? '—' : bus.ignitionOn ? 'ON' : 'OFF'}
                  accent={bus.ignitionOn ? 'green' : 'default'}
                />
                <Readout
                  label="GPS Timestamp"
                  value={bus.gpsTimestamp ? formatIndiaDateTime(bus.gpsTimestamp) : '—'}
                />
                <Readout label="Last Update" value={formatRelativeAge(bus.gpsTimestamp)} />
                <Readout label="Vehicle Status" value={bus.rawStatus ?? '—'} />
                <div>
                  <div className="hud-label">Data Quality</div>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${quality?.dot}`} aria-hidden />
                    <span className="font-mono text-sm text-holo-glow">{quality?.label}</span>
                  </div>
                  <span className="sr-only">{quality?.description}</span>
                </div>
              </div>
            </section>

            {/* ---- LIVE UPSRTC SCHEDULE ---- */}
            <section className="border-b border-holo-glow/12 px-4 py-3">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RouteIcon className="h-3 w-3 text-alert-green" aria-hidden />
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-alert-green">
                    {LIVE_LABELS.schedule}
                  </h3>
                </div>
                {isLoadingSchedule && (
                  <span className="animate-flicker font-mono text-[9px] text-holo-glow/50">
                    Fetching…
                  </span>
                )}
              </div>

              {isLoadingSchedule && !schedule && (
                <div className="space-y-1.5" aria-hidden>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-7 animate-pulse rounded bg-holo-glow/[0.05]" />
                  ))}
                </div>
              )}

              {!isLoadingSchedule && !schedule && (
                <p className="rounded border border-holo-glow/15 bg-void-900/50 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-holo-glow/50">
                  {scheduleMessage ??
                    'No UPSRTC schedule is assigned to this vehicle for the current date.'}
                </p>
              )}

              {schedule && (
                <>
                  <div className="mb-2.5 grid grid-cols-2 gap-x-3 gap-y-2.5">
                    <Readout label="Origin" value={schedule.originName ?? '—'} />
                    <Readout label="Destination" value={schedule.destinationName ?? '—'} />
                    <Readout
                      label="Scheduled Departure"
                      value={formatScheduleTime(schedule.scheduledDeparture)}
                    />
                    <Readout
                      label="Scheduled Arrival"
                      value={formatScheduleTime(schedule.scheduledArrival)}
                    />
                    <Readout label="Route" value={schedule.routeName ?? '—'} />
                    <Readout label="Direction" value={schedule.direction ?? '—'} />
                  </div>

                  <details className="group rounded border border-holo-glow/12 bg-void-900/40">
                    <summary className="cursor-pointer list-none px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-holo-glow/60 hover:text-holo-glow">
                      <Clock className="mr-1.5 inline h-3 w-3" aria-hidden />
                      Stop sequence ({schedule.stops.length} stops)
                      {schedule.tripCount > 1 && (
                        <span className="ml-1.5 text-holo-glow/35">
                          · current trip of {schedule.tripCount} today
                        </span>
                      )}
                    </summary>
                    <ol className="max-h-52 overflow-y-auto border-t border-holo-glow/10">
                      {schedule.stops.map((stop) => (
                        <li
                          key={stop.id}
                          className="flex items-center justify-between gap-2 border-b border-holo-glow/[0.06] px-2.5 py-1.5 last:border-0"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="w-5 shrink-0 font-mono text-[9px] text-holo-glow/35">
                              {stop.sequence}
                            </span>
                            <span className="truncate font-mono text-[10px] text-holo-glow/75">
                              {stop.name}
                            </span>
                            {stop.latitude === null && (
                              <span
                                className="shrink-0 font-mono text-[8px] text-holo-glow/30"
                                title="No surveyed coordinates upstream"
                              >
                                no geo
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-holo-teal">
                            {formatScheduleTime(stop.scheduledArrival)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>
                </>
              )}
            </section>

            {/* ---- ANALYSIS ---- */}
            <section className="px-4 py-3">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-holo-teal">
                  Operational Analysis
                </h3>
                <span className="rounded border border-holo-teal/40 bg-holo-teal/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-holo-teal">
                  Predictive
                </span>
              </div>

              <div className="space-y-1.5">
                {ANALYSIS_ACTIONS.map(({ kind, label, icon: Icon, testId, detail }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => openAnalysis(kind)}
                    data-testid={testId}
                    className="group flex w-full items-center gap-3 rounded border border-holo-glow/20 bg-holo-glow/[0.04] px-3 py-2.5 text-left transition-all hover:border-holo-glow/60 hover:bg-holo-glow/12 focus-visible:border-holo-glow"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-holo-glow/25 bg-void-900/70 transition-colors group-hover:border-holo-glow/60">
                      <Icon className="h-4 w-4 text-holo-glow" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[11px] uppercase tracking-wider text-holo-glow">
                        {label}
                      </span>
                      <span className="block font-mono text-[9px] text-holo-glow/40">{detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
