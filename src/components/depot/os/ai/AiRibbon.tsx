'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, Cpu } from 'lucide-react';
import { depotIdFromPath } from '@/lib/depot/depotNav';
import { routeHeadways } from '@/lib/depot/os/intel/headways';
import { insightFor, ribbonItems, type RibbonTone, type ScheduleFacts } from '@/lib/depot/os/intel/ribbon';
import { DEFAULT_BUS_PARAMS } from '@/lib/depot/os/sched/config';
import { tripsFor } from '@/lib/depot/os/sched/trips';
import { baselineBuses, restrictBuses } from '@/lib/depot/os/sched/vehicles';
import { activeView } from '@/lib/depot/os/workspaces';
import { useIntel } from '../IntelProvider';
import { latestKey, useSchedStore } from '../sched/schedStore';
import { useSchedInput } from '../sched/useSchedInput';
import { useAiStore } from './aiStore';

const TONE: Readonly<Record<RibbonTone, string>> = {
  crimson: 'text-alert-crimson',
  amber: 'text-alert-amber',
  teal: 'text-holo-teal',
  cyan: 'text-holo-glow',
  slate: 'text-depot-prose',
};
const OPEN_KEY = 'depot-os-insights-open-v1';

/** The original plan's conflicts and gaps for a depot, from the same engine the AI Bus Scheduler runs. */
function useScheduleFacts(depotId: string | null, enabled: boolean): ScheduleFacts | null {
  const input = useSchedInput(enabled && depotId ? depotId : '', null);
  const latest = useSchedStore((s) => (depotId ? (s.latest[latestKey('bus', depotId)] ?? null) : null));
  return useMemo(() => {
    if (!enabled || !input.timetable) return null;
    const buses = restrictBuses(input.buses, DEFAULT_BUS_PARAMS);
    const plan = baselineBuses(input.timetable, tripsFor(input.timetable, DEFAULT_BUS_PARAMS), buses, DEFAULT_BUS_PARAMS);
    const sameDay = latest && latest.date === input.timetable.operatingDate;
    return {
      conflicts: plan.conflicts.length,
      uncovered: plan.metrics.uncovered,
      departures: plan.metrics.departures,
      held: buses.filter((b) => b.restriction !== null).length,
      optimisedCovered: sameDay ? (latest.figures.covered ?? null) : null,
    };
  }, [enabled, input.timetable, input.buses, latest]);
}

/**
 * The AI ribbon under the workspace's breadcrumb: what the engine holds for this
 * workspace and context, every figure a link to its records, and, opened, the
 * workspace's insight in four lines. It shows nothing until the first cycle has run.
 */
export function AiRibbon() {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const active = activeView(pathname, search);
  const depotId = depotIdFromPath(pathname);
  const intel = useIntel();
  const findings = useAiStore((s) => s.findings);
  const cycle = useAiStore((s) => s.cycle);
  const intervalSec = useAiStore((s) => s.intervalSec);
  const running = useAiStore((s) => s.running);
  const workspace = active?.workspace.id ?? null;
  const schedule = useScheduleFacts(depotId, workspace === 'operations');
  const bunched = useMemo(() => {
    if (workspace !== 'network' || !intel.fleet) return null;
    const scoped = intel.scope ? intel.fleet.filter((b) => b.depotId !== null && intel.scope!.has(b.depotId)) : intel.fleet;
    return routeHeadways(scoped).filter((r) => r.pairs.length > 0).length;
  }, [workspace, intel.fleet, intel.scope]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      // Closed by default.
    }
  }, []);

  if (!workspace || !findings) return null;
  const items = ribbonItems({ workspace, findings, depotId, bunchedRoutes: bunched, schedule, cycle, intervalSec });
  const insight = insightFor(workspace, intel.decisions, findings, schedule, depotId);
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      // The choice holds for this view.
    }
  };

  return (
    <section className="os-ribbon mb-4" aria-label="AI status for this workspace" data-testid="os-ai-ribbon">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
        <span className="os-ribbon-badge">
          <Cpu className={`h-3 w-3 ${running ? 'animate-pulse' : ''}`} aria-hidden />
          AI status
        </span>
        {items.map((it, i) => (
          <span key={it.key} className="flex min-w-0 items-center">
            {i > 0 ? <span className="mx-1.5 h-3 w-px bg-depot-line" aria-hidden /> : null}
            <Link href={it.href} className="os-ribbon-item">
              <span className={`font-semibold ${TONE[it.tone]}`}>{it.value}</span>
              <span className="truncate">{it.label}</span>
            </Link>
          </span>
        ))}
        {insight ? (
          <button type="button" onClick={toggle} aria-expanded={open} className="ml-auto inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-depot-muted hover:text-holo-glow">
            Insight
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        ) : null}
      </div>
      {open && insight ? (
        <dl className="os-stream-in mt-2 grid grid-cols-1 gap-x-4 gap-y-2 border-t border-holo-glow/10 pt-2 sm:grid-cols-2 2xl:grid-cols-4">
          {[
            { label: 'Identified', text: insight.identified },
            { label: 'Predicts', text: insight.predicts },
            { label: 'Recommends', text: insight.recommends },
            { label: 'Expected impact', text: insight.impact },
          ].map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="os-kicker">{row.label}</dt>
              <dd className="font-sans text-[12.5px] leading-[18px] text-depot-ink">
                {row.label === 'Identified' ? (
                  <Link href={insight.href} className="hover:text-holo-glow hover:underline">
                    {row.text}
                  </Link>
                ) : (
                  row.text
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
