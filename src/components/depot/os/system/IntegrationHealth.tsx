'use client';

import Link from 'next/link';
import { CheckCircle2, CircleDashed, PlugZap } from 'lucide-react';
import { formatCount, formatFeedTime } from '@/lib/depot/format';
import { SOURCES_PATH } from '@/lib/depot/nav';
import { DATA_STATUS_LABEL, DATA_STATUS_TITLE, type DataStatus } from '@/lib/depot/os/dataStatus';
import { summariseRegions } from '@/lib/depot/os/regions';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { MeterBar, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';

type Connection = 'connected' | 'on_request' | 'scenario';

interface Source {
  readonly name: string;
  readonly feeds: string;
  readonly connection: Connection;
  readonly status: DataStatus;
  readonly replaces: string;
}

const SOURCES: readonly Source[] = [
  { name: 'UPSRTC GPS feed', feeds: 'Positions, states, routes carried, Mission Control, maps, incidents', connection: 'connected', status: 'live', replaces: '—' },
  { name: 'Corporation schedule server', feeds: 'A bus’s timetable for the day, looked up when a person asks', connection: 'on_request', status: 'live', replaces: '—' },
  { name: 'Timetable master', feeds: 'Duties, departures, the AI Scheduler’s need', connection: 'scenario', status: 'scenario', replaces: 'Duty plan, readiness, disruption' },
  { name: 'Crew roster', feeds: 'Driver and conductor availability', connection: 'scenario', status: 'scenario', replaces: 'Crew, readiness' },
  { name: 'Workshop and maintenance records', feeds: 'Service history, repairs, bays', connection: 'scenario', status: 'scenario', replaces: 'Fleet health, predictive maintenance' },
  { name: 'Fuel issue register', feeds: 'Litres issued per journey', connection: 'scenario', status: 'scenario', replaces: 'Fuel audit, cost optimisation' },
  { name: 'Ticketing (ETM)', feeds: 'Boardings and revenue by route', connection: 'scenario', status: 'scenario', replaces: 'Revenue intelligence' },
  { name: 'Passenger counters', feeds: 'Independent boarding counts', connection: 'scenario', status: 'scenario', replaces: 'Revenue leakage pilot' },
  { name: 'Depot asset register', feeds: 'Parking, bays, fuel points', connection: 'scenario', status: 'scenario', replaces: 'Digital twin, bay plan' },
];

const CONNECTION_LABEL: Readonly<Record<Connection, string>> = {
  connected: 'Connected',
  on_request: 'On request',
  scenario: 'Scenario records',
};

/**
 * Integration health and data quality: the GPS feed's freshness, which sources are
 * connected and which run on scenario records until connected, how fully the feed's
 * fields are populated, and how regions are assigned.
 */
export function IntegrationHealth() {
  const intel = useIntel();
  const network = intel.network;
  const regions = summariseRegions(network?.depots ?? []);
  const named = intel.fleet ? intel.fleet.filter((b) => b.routeName).length : null;
  const positioned = intel.fleet ? intel.fleet.filter((b) => b.lat !== null).length : null;

  return (
    <div className="space-y-4" data-testid="os-integration-health">
      <OsHeader
        title="Integration health"
        description="What is connected, what runs on scenario records until it is, and how complete the feed is."
        statuses={['live', 'scenario']}
        actions={<Link href={SOURCES_PATH} className="os-button os-button-quiet">Data sources registry</Link>}
      />
      {!network ? (
        <PanelLoading rows={5} label="Reading the feed" />
      ) : (
        <>
          <MetricStrip columns={6}>
            <Metric label="Feed clock" value={formatFeedTime(network.feedNow)} sub={network.stale ? 'Last good data' : 'Current'} tone={network.stale ? 'amber' : 'green'} status="live" />
            <Metric label="Records" value={formatCount(network.recordCount)} sub="In the latest snapshot" />
            <Metric label="Reporting now" value={formatCount(network.kpis.reporting.value)} sub="Fix in the reporting window" />
            <Metric label="Positioned" value={positioned === null ? '—' : formatCount(positioned)} sub="Usable coordinates" />
            <Metric label="Route carried" value={named === null ? '—' : formatCount(named)} sub={intel.fleet ? `${Math.round(((named ?? 0) / intel.fleet.length) * 100)}% of buses` : ''} tone="amber" />
            <Metric label="Sources connected" value={`${SOURCES.filter((s) => s.connection !== 'scenario').length}/${SOURCES.length}`} sub="The rest are scenario" />
          </MetricStrip>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Panel kicker="Integrations" title="Every source and what it feeds" bodyClassName="p-0">
              <table className="os-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Feeds</th>
                    <th>Connection</th>
                    <th>Shown as</th>
                  </tr>
                </thead>
                <tbody>
                  {SOURCES.map((s) => (
                    <tr key={s.name} className="border-b border-holo-glow/[0.07]">
                      <td className="font-medium">{s.name}</td>
                      <td className="text-depot-prose">{s.feeds}</td>
                      <td className="whitespace-nowrap">
                        <span className={`flex items-center gap-1.5 ${s.connection === 'scenario' ? 'text-slate-300' : 'text-alert-green'}`}>
                          {s.connection === 'connected' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : s.connection === 'on_request' ? <PlugZap className="h-3.5 w-3.5" aria-hidden /> : <CircleDashed className="h-3.5 w-3.5" aria-hidden />}
                          {CONNECTION_LABEL[s.connection]}
                        </span>
                      </td>
                      <td><StatusTag status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <div className="flex min-w-0 flex-col gap-4">
              <Panel kicker="Data quality" title="Feed field completeness" actions={<StatusTag status="live" />} bodyClassName="space-y-2 p-4">
                {network.coverage.map((c) => (
                  <div key={c.field}>
                    <div className="mb-0.5 flex justify-between font-sans text-[12px] text-depot-prose">
                      <span>{c.label}</span>
                      <span className="font-mono text-depot-ink">{c.of > 0 ? Math.round((c.populated / c.of) * 100) : 0}%</span>
                    </div>
                    <MeterBar value={c.populated} max={c.of} tone={c.of > 0 && c.populated / c.of < 0.5 ? 'amber' : 'green'} />
                  </div>
                ))}
              </Panel>
              <Panel kicker="Figure kinds" title="What each tag means" bodyClassName="space-y-2 p-4">
                {(Object.keys(DATA_STATUS_LABEL) as DataStatus[]).map((k) => (
                  <div key={k} className="flex items-start gap-2">
                    <StatusTag status={k} />
                    <p className="depot-caption">{DATA_STATUS_TITLE[k]}</p>
                  </div>
                ))}
              </Panel>
              <Panel kicker="Regions" title={`${regions.length} regions, assigned by rule`} bodyClassName="p-4">
                <p className="depot-note">
                  The feed carries no region. A depot named after a regional city belongs to that region; any other depot goes to the nearest regional office from its
                  buses&apos; median position. Replace with the corporation&apos;s own depot-to-region list when supplied.
                </p>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
