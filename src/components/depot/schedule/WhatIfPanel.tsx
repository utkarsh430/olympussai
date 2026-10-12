'use client';

import { useId, useState } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { ScheduleLimits } from '@/lib/depot/schedule/api';
import type { ScheduleParams } from '@/lib/depot/schedule/types';

export interface WhatIfPanelProps {
  readonly routes: readonly string[];
  readonly limits: ScheduleLimits;
  readonly busy: boolean;
  readonly inForce: string;
  readonly clamped: readonly string[];
  readonly error: string | null;
  readonly onRun: (params: ScheduleParams) => void;
  readonly onReset: () => void;
}

const numberOr = (raw: string): number | undefined => (raw.trim() === '' ? undefined : Number(raw));

/** The what-if controls: every field blank means its default; Run asks the server, Reset returns to the baseline. */
export function WhatIfPanel(props: WhatIfPanelProps) {
  const { routes, limits, busy, inForce, clamped, error, onRun, onReset } = props;
  const id = useId();
  const [surge, setSurge] = useState('');
  const [route, setRoute] = useState('');
  const [routeSurge, setRouteSurge] = useState('');
  const [load, setLoad] = useState('');
  const [drivers, setDrivers] = useState('');
  const [conductors, setConductors] = useState('');
  const [blockHours, setBlockHours] = useState('');
  const [turnaround, setTurnaround] = useState('');
  const [out, setOut] = useState('');
  const [lockBus, setLockBus] = useState('');
  const [lockRoute, setLockRoute] = useState('');

  function run(): void {
    const params: ScheduleParams = {
      demandSurgePercent: numberOr(surge),
      routeSurges: route && routeSurge.trim() !== '' ? [{ routeName: route, percent: Number(routeSurge) }] : undefined,
      targetLoad: load.trim() === '' ? undefined : Number(load) / 100,
      crewUnavailable: { driver: numberOr(drivers), conductor: numberOr(conductors) },
      maxBlockMinutes: blockHours.trim() === '' ? undefined : Number(blockHours) * 60,
      minTurnaroundMinutes: numberOr(turnaround),
      busesOutOfService: out.trim() === '' ? undefined : out.split(/[\s,]+/).filter((s) => s.length > 0),
      locks: lockBus.trim() !== '' && lockRoute ? [{ registrationNumber: lockBus.trim(), routeName: lockRoute }] : undefined,
    };
    onRun(params);
  }

  function reset(): void {
    setSurge(''); setRoute(''); setRouteSurge(''); setLoad(''); setDrivers(''); setConductors('');
    setBlockHours(''); setTurnaround(''); setOut(''); setLockBus(''); setLockRoute('');
    onReset();
  }

  const field = (label: string, value: string, set: (v: string) => void, unit: string, extra?: { readonly min?: number; readonly max?: number; readonly step?: number }) => (
    <label className="flex flex-col gap-1 font-sans text-[12px] text-depot-muted">
      {label}
      <span className="flex items-center gap-1">
        <input type="number" value={value} onChange={(e) => set(e.target.value)} className="depot-field w-24 py-0.5" min={extra?.min} max={extra?.max} step={extra?.step ?? 1} />
        <span className="font-mono text-[11px]">{unit}</span>
      </span>
    </label>
  );

  return (
    <section aria-labelledby={`${id}-h`} className="min-w-0 rounded-md border border-depot-line p-3">
      <SectionLabel label="What-if" note={inForce === '' ? 'baseline plan' : 'what-if in force'} />
      <form
        className="flex flex-wrap gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        {field('Demand change', surge, setSurge, '%', { min: limits.surgePercent.min, max: limits.surgePercent.max })}
        <label className="flex flex-col gap-1 font-sans text-[12px] text-depot-muted">
          Route
          <select value={route} onChange={(e) => setRoute(e.target.value)} className="depot-select w-40">
            <option value="">whole depot</option>
            {routes.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        {route ? field('Route demand change', routeSurge, setRouteSurge, '%') : null}
        {field('Target load', load, setLoad, '%', { min: limits.targetLoad.min * 100, max: limits.targetLoad.max * 100 })}
        {field('Drivers unavailable', drivers, setDrivers, 'slots', { min: 0 })}
        {field('Conductors unavailable', conductors, setConductors, 'slots', { min: 0 })}
        {field('Longest block', blockHours, setBlockHours, 'h', { min: limits.blockMinutes.min / 60, max: limits.blockMinutes.max / 60, step: 0.5 })}
        {field('Turnaround', turnaround, setTurnaround, 'min', { min: 0, max: limits.turnaroundMinutes.max, step: 5 })}
        <label className="flex flex-col gap-1 font-sans text-[12px] text-depot-muted">
          Buses out of service
          <input type="text" value={out} onChange={(e) => setOut(e.target.value)} placeholder="registrations, comma separated" className="depot-field w-64 py-0.5" />
        </label>
        <label className="flex flex-col gap-1 font-sans text-[12px] text-depot-muted">
          Lock a bus
          <span className="flex items-center gap-1">
            <input type="text" value={lockBus} onChange={(e) => setLockBus(e.target.value)} placeholder="registration" className="depot-field w-36 py-0.5" />
            <select value={lockRoute} onChange={(e) => setLockRoute(e.target.value)} className="depot-select w-36" aria-label="Route to lock the bus to">
              <option value="">to route…</option>
              {routes.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </span>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" disabled={busy} className="depot-button-primary">{busy ? 'Planning…' : 'Run what-if'}</button>
          <button type="button" onClick={reset} className="depot-filter-button">Reset</button>
        </div>
      </form>
      {inForce ? <p className="depot-prose mt-2" role="status">{inForce}</p> : null}
      {error ? <p className="depot-note text-alert-amber" role="alert">{error}</p> : null}
      {clamped.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5">
          {clamped.map((note) => (
            <li key={note} className="depot-note">{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
