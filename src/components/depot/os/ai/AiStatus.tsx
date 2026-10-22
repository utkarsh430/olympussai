'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Cpu, RefreshCw, Settings } from 'lucide-react';
import { depotHref, depotIdFromPath } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { ACTIVITY_PATH, SETTINGS_PATH } from '@/lib/depot/os/workspaces';
import { useAiStore } from './aiStore';
import { ActivityStream, streamTime } from './ActivityStream';

/** Seconds to the next scheduled cycle, ticking; empty when the cycle is paused. */
function Countdown({ className = '' }: { readonly className?: string }) {
  const nextRunAt = useAiStore((s) => s.nextRunAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (nextRunAt === null) return undefined;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [nextRunAt]);
  if (nextRunAt === null) return null;
  const left = Math.max(0, Math.round((nextRunAt - now) / 1000));
  return <span className={className}>Next {`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</span>;
}

/**
 * The AI engine's state in the bar: whether a cycle is running or complete, the insights
 * and proposals it holds for the context, and the time to the next scheduled cycle. It
 * opens the latest activity, the engine's figures and a way to run a cycle now.
 */
export function AiStatus() {
  const findings = useAiStore((s) => s.findings);
  const running = useAiStore((s) => s.running);
  const intervalSec = useAiStore((s) => s.intervalSec);
  const lastRunAt = useAiStore((s) => s.lastRunAt);
  const lastDurationMs = useAiStore((s) => s.lastDurationMs);
  const cycle = useAiStore((s) => s.cycle);
  const events = useAiStore((s) => s.events);
  const requestRun = useAiStore((s) => s.requestRun);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname() ?? '';
  const depotId = depotIdFromPath(pathname);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const insights = findings?.decisions.length ?? 0;
  const proposals = findings?.transfers ?? 0;
  const state = !findings ? 'Reading the snapshot' : running ? 'Analysing' : intervalSec === 0 ? 'Analysis paused' : 'Analysis complete';
  const coverage = findings && findings.fleet > 0 ? Math.round((findings.positioned / findings.fleet) * 100) : null;
  const activityHref = depotId ? `${depotHref(depotId)}/activity` : ACTIVITY_PATH;

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="os-ai-status"
        title={findings ? `${state}. ${insights} decisions and ${proposals} transfer proposals in this context.` : state}
        className="os-ai-status"
      >
        <span className={`os-ai-core ${running || !findings ? 'os-ai-core-busy' : ''}`} aria-hidden />
        <span className="font-semibold text-holo-glow">AI Engine</span>
        <span className="hidden text-depot-prose min-[1880px]:inline">· {state}</span>
        {findings ? (
          <>
            <span className="hidden text-depot-ink lg:inline">· {formatCount(insights)} insights</span>
            <span className="hidden text-holo-teal min-[1720px]:inline">· {formatCount(proposals)} proposals</span>
            {findings.critical > 0 ? <span className="text-alert-crimson">· {formatCount(findings.critical)}<span className="hidden xl:inline"> critical</span></span> : null}
          </>
        ) : null}
        <Countdown className="hidden text-depot-muted 2xl:inline" />
      </button>
      {open ? (
        <div id={panelId} className="os-popover right-0 w-[min(30rem,calc(100vw-1.5rem))]" role="dialog" aria-label="AI engine">
          <div className="flex items-start justify-between gap-3 border-b border-depot-line px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-holo-glow" aria-hidden />
                <span className="os-heading">{state}</span>
              </div>
              <p className="mt-0.5 font-sans text-[11.5px] text-depot-prose">
                {lastRunAt !== null
                  ? `Cycle ${formatCount(cycle)} ran at ${streamTime(lastRunAt)} in ${Math.max(1, Math.round(lastDurationMs ?? 0))} ms on ${findings?.analyses ?? 0} analyses`
                  : 'Waiting for the first snapshot'}
                {intervalSec > 0 ? ` · every ${intervalSec} s` : ' · scheduled cycle paused'}
              </p>
            </div>
            <button type="button" onClick={requestRun} className="os-button os-button-quiet" disabled={!findings}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Run now
            </button>
          </div>
          {findings ? (
            <dl className="grid grid-cols-4 gap-px border-b border-depot-line bg-depot-line/40 text-center">
              {[
                { label: 'Insights', value: formatCount(insights), tone: 'text-depot-ink' },
                { label: 'Critical', value: formatCount(findings.critical), tone: findings.critical > 0 ? 'text-alert-crimson' : 'text-depot-ink' },
                { label: 'Proposals', value: formatCount(proposals), tone: 'text-holo-teal' },
                { label: 'GPS coverage', value: coverage === null ? '—' : `${coverage}%`, tone: 'text-depot-ink' },
              ].map((m) => (
                <div key={m.label} className="bg-depot-surface px-2 py-2">
                  <dt className="os-kicker">{m.label}</dt>
                  <dd className={`font-mono text-[17px] ${m.tone}`}>{m.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="os-scroll max-h-[320px] overflow-y-auto">
            <ActivityStream events={events.slice(0, 8)} compact onNavigate={() => setOpen(false)} />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-depot-line px-4 py-2.5">
            <Link href={activityHref} className="depot-link font-sans text-[12px]">
              All network activity
            </Link>
            <Link href={SETTINGS_PATH} className="inline-flex items-center gap-1 font-sans text-[12px] text-depot-prose hover:text-holo-glow">
              <Settings className="h-3.5 w-3.5" aria-hidden />
              Analysis settings
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
