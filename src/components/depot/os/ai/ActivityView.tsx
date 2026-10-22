'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import type { DataStatus } from '@/lib/depot/os/dataStatus';
import { INCIDENTS_PATH, REBALANCE_PATH } from '@/lib/depot/nav';
import { DECISIONS_PATH, FUEL_AUDIT_PATH, MISSION_PATH, RELIABILITY_PATH, SETTINGS_PATH, type AiKind } from '@/lib/depot/os/workspaces';
import { AI_KIND, AiGlyph } from '../aiKinds';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { LocalTabs, Panel, StatusTag } from '../ui';
import { ActivityStream, streamTime } from './ActivityStream';
import { useAiStore } from './aiStore';

type KindFilter = 'all' | AiKind;
type SourceFilter = 'all' | 'live' | 'modelled';

const MODELLED: ReadonlySet<DataStatus> = new Set(['forecast', 'estimate', 'scenario', 'proposed']);

/**
 * Network activity: everything the AI engine's cycles found or changed, newest first,
 * with the engine beside it: its schedule, its last cycle, and what each of its analyses
 * holds now, each a link to the records behind it.
 */
export function ActivityView() {
  const intel = useIntel();
  const events = useAiStore((s) => s.events);
  const findings = useAiStore((s) => s.findings);
  const cycle = useAiStore((s) => s.cycle);
  const lastRunAt = useAiStore((s) => s.lastRunAt);
  const lastDurationMs = useAiStore((s) => s.lastDurationMs);
  const intervalSec = useAiStore((s) => s.intervalSec);
  const running = useAiStore((s) => s.running);
  const requestRun = useAiStore((s) => s.requestRun);
  const [kind, setKind] = useState<KindFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const base = intel.scopeDepotId ? depotHref(intel.scopeDepotId) : null;
  const name = intel.scopeDepotId ? (intel.depotsById.get(intel.scopeDepotId)?.name ?? 'this depot') : 'the network';

  const shown = useMemo(
    () =>
      events.filter(
        (e) =>
          (kind === 'all' || e.kind === kind) &&
          (source === 'all' || (source === 'live' ? e.status === 'live' || e.status === 'derived' : MODELLED.has(e.status))),
      ),
    [events, kind, source],
  );

  const pipeline = findings
    ? [
        { kind: 'monitor' as const, status: 'live' as const, label: 'GPS snapshot', value: `${formatCount(findings.positioned)} reporting · ${formatCount(findings.onRoad)} on road`, href: base ? `${base}/cockpit` : MISSION_PATH },
        { kind: 'predict' as const, status: 'estimate' as const, label: 'Fleet health', value: `${formatCount(findings.highRisk)} high risk · ${formatCount(findings.overdue)} overdue`, href: base ? `${base}/health` : RELIABILITY_PATH },
        { kind: 'anomaly' as const, status: 'scenario' as const, label: 'Fuel audit', value: findings.fuelFlags === null ? 'Running after paint' : `${formatCount(findings.fuelFlags)} journeys · ₹${formatCount(findings.fuelExposure ?? 0)}`, href: base ? `${base}/fuel-audit` : FUEL_AUDIT_PATH },
        { kind: 'predict' as const, status: 'estimate' as const, label: 'Peak fleet need', value: `${formatCount(findings.shortDepots.length)} depots short · ${formatCount(findings.busesShort)} buses`, href: REBALANCE_PATH },
        { kind: 'optimize' as const, status: 'proposed' as const, label: 'Redistribution', value: `${formatCount(findings.transfers)} transfers · ${formatCount(findings.busesToMove)} buses`, href: REBALANCE_PATH },
        { kind: 'anomaly' as const, status: 'derived' as const, label: 'Breakdown screen', value: `${formatCount(findings.incidents)} likely incidents`, href: base ? `${base}/incidents` : INCIDENTS_PATH },
        { kind: 'recommend' as const, status: 'derived' as const, label: 'Decision queue', value: `${formatCount(findings.decisions.length)} ranked · ${formatCount(findings.critical)} critical`, href: base ? `${base}/decisions` : DECISIONS_PATH },
      ]
    : [];

  return (
    <div className="space-y-4" data-testid="os-activity">
      <OsHeader
        title="Network activity"
        description={`What the AI engine's analysis cycles found and changed for ${name}, newest first. A quiet network gives a quiet stream.`}
        statuses={['live', 'derived', 'scenario']}
        actions={
          <button type="button" onClick={requestRun} disabled={!findings || running} className="os-button" data-testid="os-run-analysis">
            <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} aria-hidden />
            Run analysis now
          </button>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel kicker="AI activity stream" title={`${formatCount(shown.length)} of ${formatCount(events.length)} events this session`} bodyClassName="flex min-h-0 flex-col p-0" className="xl:h-[720px]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-holo-glow/10 pr-3">
            <LocalTabs<KindFilter>
              label="Kind of AI work"
              value={kind}
              onChange={setKind}
              items={[{ key: 'all', label: 'All' }, ...(['monitor', 'predict', 'optimize', 'anomaly', 'recommend'] as const).map((k) => ({ key: k, label: AI_KIND[k].short }))]}
            />
            <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label="Source" className="depot-control depot-select font-sans">
              <option value="all">Every source</option>
              <option value="live">GPS feed and derived</option>
              <option value="modelled">Scenario, forecast and proposals</option>
            </select>
          </div>
          <div className="os-scroll min-h-0 flex-1 overflow-y-auto">
            <ActivityStream events={shown} emptyText={events.length === 0 ? undefined : 'No event of this kind yet this session.'} />
          </div>
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel kicker="AI engine" title={running ? 'Analysing' : intervalSec === 0 ? 'Scheduled cycle paused' : `Cycle every ${intervalSec} s`} strong bodyClassName="space-y-3 p-4">
            <dl className="grid grid-cols-3 gap-2">
              <div>
                <dt className="os-kicker">Cycles</dt>
                <dd className="font-mono text-[18px] text-depot-ink">{formatCount(cycle)}</dd>
              </div>
              <div>
                <dt className="os-kicker">Last run</dt>
                <dd className="font-mono text-[14px] text-depot-ink">{lastRunAt === null ? '—' : streamTime(lastRunAt)}</dd>
              </div>
              <div>
                <dt className="os-kicker">Took</dt>
                <dd className="font-mono text-[14px] text-depot-ink">{lastDurationMs === null ? '—' : `${Math.max(1, Math.round(lastDurationMs))} ms`}</dd>
              </div>
            </dl>
            <p className="depot-note">
              Each cycle re-runs the decision engine on the current snapshot and compares every finding with the cycle before. Times are this browser&apos;s clock; the feed&apos;s own time is in each GPS line.
            </p>
            <Link href={SETTINGS_PATH} className="depot-link font-sans text-[12px]">Change the cycle</Link>
          </Panel>
          <Panel kicker="Analyses in the cycle" title="What each holds now" bodyClassName="p-0">
            {pipeline.length === 0 ? (
              <p className="px-4 py-4 font-sans text-[12.5px] text-depot-prose">Waiting for the first snapshot.</p>
            ) : (
              <ul className="divide-y divide-holo-glow/[0.06]">
                {pipeline.map((p) => (
                  <li key={p.label}>
                    <Link href={p.href} className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-depot-raised">
                      <AiGlyph kind={p.kind} className="h-3.5 w-3.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-sans text-[12.5px] font-semibold text-depot-ink">{p.label}</span>
                        <span className="block font-mono text-[11.5px] text-depot-prose">{p.value}</span>
                      </span>
                      <StatusTag status={p.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
