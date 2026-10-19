'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ArrowUpRight, CalendarClock, Combine, UsersRound } from 'lucide-react';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { INCIDENTS_PATH, REBALANCE_PATH } from '@/lib/depot/nav';
import { DECISIONS_PATH, FUEL_AUDIT_PATH, MISSION_PATH, SECTION_ANCHOR, SIMULATION_PATH, type AiKind } from '@/lib/depot/os/workspaces';
import { AI_KIND } from '../aiKinds';
import { latestKey, useSchedStore } from '../sched/schedStore';
import { EmptyNote, Panel } from '../ui';
import { ActivityStream } from './ActivityStream';
import { useAiStore } from './aiStore';

interface PulseRow {
  readonly kind: AiKind;
  readonly value: string;
  readonly text: string;
  readonly href: string;
}

/**
 * The six kinds of AI work, each with what it holds now for the context and a link to
 * it: a single glance that the system is watching, projecting, flagging, recommending,
 * optimising and simulating, from the last analysis cycle's figures.
 */
export function AiPulse({ depotId }: { readonly depotId: string | null }) {
  const f = useAiStore((s) => s.findings);
  const saved = useSchedStore((s) => s.saved.length);
  const hydrate = useSchedStore((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  const base = depotId ? depotHref(depotId) : null;
  if (!f) {
    return (
      <Panel kicker="AI capability pulse" title="Six kinds of AI work">
        <EmptyNote>Waiting for the first analysis cycle.</EmptyNote>
      </Panel>
    );
  }
  const rows: PulseRow[] = [
    { kind: 'monitor', value: formatCount(f.positioned), text: `buses reporting; ${formatCount(f.onRoad)} on the road`, href: base ? `${base}/cockpit` : MISSION_PATH },
    { kind: 'predict', value: formatCount(f.busesShort), text: `buses short at the morning peak across ${formatCount(f.shortDepots.length)} depots`, href: REBALANCE_PATH },
    { kind: 'anomaly', value: formatCount(f.incidents + (f.fuelFlags ?? 0)), text: `flags: ${formatCount(f.incidents)} likely breakdowns, ${formatCount(f.fuelFlags ?? 0)} fuel journeys`, href: f.incidents > 0 ? (base ? `${base}/incidents` : INCIDENTS_PATH) : `${base ? `${base}/fuel-audit` : FUEL_AUDIT_PATH}?section=${SECTION_ANCHOR.anomalyQueue}` },
    { kind: 'recommend', value: formatCount(f.decisions.length), text: `decisions ranked, ${formatCount(f.critical)} critical`, href: base ? `${base}/decisions` : DECISIONS_PATH },
    { kind: 'optimize', value: formatCount(f.transfers), text: `transfers proposed, moving ${formatCount(f.busesToMove)} buses`, href: `${REBALANCE_PATH}?section=${SECTION_ANCHOR.transfers}` },
    { kind: 'simulate', value: formatCount(saved), text: 'scenarios saved; what-ifs on demand, fleet and plan run on request', href: SIMULATION_PATH },
  ];
  return (
    <Panel kicker="AI capability pulse" title="What each kind of AI work holds now" bodyClassName="p-0" testId="os-ai-pulse">
      <ul className="divide-y divide-holo-glow/[0.06]">
        {rows.map((r) => {
          const meta = AI_KIND[r.kind];
          const Icon = meta.icon;
          return (
            <li key={r.kind}>
              <Link href={r.href} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-depot-raised">
                <span className={`os-pulse-icon ${r.kind === 'optimize' ? 'os-pulse-icon-teal' : ''}`}>
                  <Icon className={`h-4 w-4 ${meta.tone}`} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-depot-muted">{meta.label}</span>
                  <span className="block truncate font-sans text-[12.5px] text-depot-ink">{r.text}</span>
                </span>
                <span className={`font-mono text-[18px] tabular-nums ${meta.tone}`}>{r.value}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** The live activity stream, compact, for Mission Control. */
export function ActivityPanel({ depotId }: { readonly depotId: string | null }) {
  const events = useAiStore((s) => s.events);
  return (
    <Panel
      kicker="AI activity stream"
      title="What the engine found, as it found it"
      bodyClassName="os-scroll max-h-[360px] overflow-y-auto p-0"
      actions={
        <Link href={depotId ? `${depotHref(depotId)}/activity` : '/project/depots/activity'} className="depot-link font-sans text-[12px]">
          All activity
        </Link>
      }
      testId="os-activity-panel"
    >
      <ActivityStream events={events.slice(0, 24)} compact />
    </Panel>
  );
}

/** The three flagship planners for one depot, with the latest result of each this session. */
export function FlagshipLaunch({ depotId, depotName }: { readonly depotId: string; readonly depotName: string }) {
  const latest = useSchedStore((s) => s.latest);
  const base = depotHref(depotId);
  const cards = [
    { key: 'bus', icon: CalendarClock, title: 'AI Bus Scheduler', href: `${base}/bus-scheduler`, run: `${base}/bus-scheduler?run=1`, cta: 'Generate optimal bus schedule', what: 'Shares buses across routes under five objectives and compares with the original plan.' },
    { key: 'crew', icon: UsersRound, title: 'AI Crew Scheduler', href: `${base}/crew-scheduler`, run: `${base}/crew-scheduler`, cta: 'Generate optimal crew roster', what: 'Rosters driver and conductor slots within hours, breaks and the AC endorsement.' },
    { key: 'joint', icon: Combine, title: 'Joint Fleet & Crew Optimizer', href: `${base}/optimizer`, run: `${base}/optimizer?run=1`, cta: 'Optimize depot operations', what: 'Plans buses and crews together so every departure has both.' },
  ] as const;
  return (
    <Panel kicker="Flagship AI planning" title={`Plan ${depotName}'s day`} bodyClassName="grid grid-cols-1 gap-3 p-4 lg:grid-cols-3" testId="os-flagship-launch">
      {cards.map((c) => {
        const result = latest[latestKey(c.key, depotId)];
        const Icon = c.icon;
        return (
          <div key={c.key} className="os-flagship">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-holo-teal" aria-hidden />
              <Link href={c.href} className="font-sans text-[13px] font-semibold text-depot-ink hover:text-holo-glow">
                {c.title}
              </Link>
              <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-depot-muted" aria-hidden />
            </div>
            <p className="mt-1 font-sans text-[12px] leading-4 text-depot-prose">{result ? result.summary : c.what}</p>
            <Link href={c.run} className="os-button mt-3 w-full">
              {result ? 'Open the latest plan' : c.cta}
            </Link>
          </div>
        );
      })}
    </Panel>
  );
}
